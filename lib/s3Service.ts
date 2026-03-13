import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { cfg } from "@/lib/config";

type BucketTarget =
  | "default"
  | "product_setup"
  | "video_frames"
  | "avatar_character_generation"
  | "trimmed_clips";

type BucketConfig = {
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  publicBaseUrl: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
};

const s3Clients = new Map<string, S3Client>();
let warnedMissing = false;

function getBucketConfig(target: BucketTarget): BucketConfig {
  const defaultBucket = cfg.raw("AWS_S3_BUCKET") || cfg.raw("S3_MEDIA_BUCKET");
  const defaultRegion = cfg.raw("AWS_S3_REGION") || cfg.raw("S3_MEDIA_REGION");
  const defaultEndpoint = cfg.raw("AWS_S3_ENDPOINT") || cfg.raw("S3_MEDIA_ENDPOINT");
  const accessKeyId = cfg.raw("AWS_ACCESS_KEY_ID") || cfg.raw("S3_ACCESS_KEY_ID");
  const secretAccessKey = cfg.raw("AWS_SECRET_ACCESS_KEY") || cfg.raw("S3_SECRET_ACCESS_KEY");

  const buckets: Record<BucketTarget, BucketConfig> = {
    default: {
      bucket: defaultBucket,
      region: defaultRegion,
      endpoint: defaultEndpoint,
      publicBaseUrl: null,
      accessKeyId,
      secretAccessKey,
    },
    product_setup: {
      bucket: cfg.raw("AWS_S3_BUCKET_PRODUCT_SETUP") || cfg.raw("S3_BUCKET_PRODUCT_SETUP"),
      region:
        cfg.raw("AWS_S3_REGION_PRODUCT_SETUP") || cfg.raw("S3_PRODUCT_SETUP_REGION") || defaultRegion,
      endpoint:
        cfg.raw("AWS_S3_ENDPOINT_PRODUCT_SETUP") || cfg.raw("S3_PRODUCT_SETUP_ENDPOINT") || defaultEndpoint,
      publicBaseUrl: cfg.raw("S3_PRODUCT_SETUP_PUBLIC_BASE_URL"),
      accessKeyId,
      secretAccessKey,
    },
    video_frames: {
      bucket: cfg.raw("AWS_S3_BUCKET_VIDEO_FRAMES") || cfg.raw("S3_BUCKET_VIDEO_FRAMES"),
      region:
        cfg.raw("AWS_S3_REGION_VIDEO_FRAMES") || cfg.raw("S3_VIDEO_FRAMES_REGION") || defaultRegion,
      endpoint:
        cfg.raw("AWS_S3_ENDPOINT_VIDEO_FRAMES") || cfg.raw("S3_VIDEO_FRAMES_ENDPOINT") || defaultEndpoint,
      publicBaseUrl: cfg.raw("S3_VIDEO_FRAMES_PUBLIC_BASE_URL"),
      accessKeyId,
      secretAccessKey,
    },
    avatar_character_generation: {
      bucket:
        cfg.raw("AWS_S3_BUCKET_AVATAR_CHARACTER_GENERATION") ||
        cfg.raw("S3_BUCKET_AVATAR_CHARACTER_GENERATION"),
      region:
        cfg.raw("AWS_S3_REGION_AVATAR_CHARACTER_GENERATION") ||
        cfg.raw("S3_AVATAR_CHARACTER_GENERATION_REGION") ||
        defaultRegion,
      endpoint:
        cfg.raw("AWS_S3_ENDPOINT_AVATAR_CHARACTER_GENERATION") ||
        cfg.raw("S3_AVATAR_CHARACTER_GENERATION_ENDPOINT") ||
        defaultEndpoint,
      publicBaseUrl: cfg.raw("S3_AVATAR_CHARACTER_GENERATION_PUBLIC_BASE_URL"),
      accessKeyId,
      secretAccessKey,
    },
    trimmed_clips: {
      bucket: cfg.raw("AWS_S3_BUCKET_TRIMMED_CLIPS") || cfg.raw("S3_BUCKET_TRIMMED_CLIPS"),
      region:
        cfg.raw("AWS_S3_REGION_TRIMMED_CLIPS") || cfg.raw("S3_TRIMMED_CLIPS_REGION") || defaultRegion,
      endpoint:
        cfg.raw("AWS_S3_ENDPOINT_TRIMMED_CLIPS") || cfg.raw("S3_TRIMMED_CLIPS_ENDPOINT") || defaultEndpoint,
      publicBaseUrl: cfg.raw("S3_TRIMMED_CLIPS_PUBLIC_BASE_URL"),
      accessKeyId,
      secretAccessKey,
    },
  };

  return buckets[target];
}

function getS3Client(target: BucketTarget): S3Client | null {
  const { bucket, region, endpoint, accessKeyId, secretAccessKey } = getBucketConfig(target);
  if (!bucket || !region) return null;

  const cacheKey = `${region}|${endpoint || ""}|${accessKeyId || ""}|${secretAccessKey || ""}`;
  const existing = s3Clients.get(cacheKey);
  if (existing) return existing;

  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
          }
        : undefined,
  });
  s3Clients.set(cacheKey, client);
  return client;
}

function buildPublicUrl(target: BucketTarget, key: string): string {
  const { bucket, region, endpoint, publicBaseUrl } = getBucketConfig(target);
  if (!bucket || !region) {
    return key;
  }

  if (publicBaseUrl) {
    const trimmedBase = publicBaseUrl.replace(/\/+$/, "");
    const normalizedKey = key.replace(/^\/+/, "");
    return `${trimmedBase}/${normalizedKey}`;
  }

  if (endpoint) {
    const trimmedEndpoint = endpoint.replace(/\/+$/, "");
    return `${trimmedEndpoint}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function uploadPublicObject(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
  bucketTarget?: BucketTarget;
}): Promise<string | null> {
  const bucketTarget = args.bucketTarget || "default";
  const client = getS3Client(bucketTarget);
  const { bucket } = getBucketConfig(bucketTarget);
  if (!client || !bucket) {
    return null;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl,
    })
  );

  return buildPublicUrl(bucketTarget, args.key);
}

export async function uploadProductSetupObject(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<string | null> {
  return uploadPublicObject({
    ...args,
    bucketTarget: "product_setup",
  });
}

export async function uploadVideoFrameObject(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<string | null> {
  return uploadPublicObject({
    ...args,
    bucketTarget: "video_frames",
  });
}

export async function uploadAvatarCharacterObject(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<string | null> {
  return uploadPublicObject({
    ...args,
    bucketTarget: "avatar_character_generation",
  });
}

export async function uploadFrame(
  localPath: string,
  assetId: string,
  timestamp: number
): Promise<string | null> {
  // TODO(low): this warning is global; include target details if bucket-level config diverges later.
  if (!getS3Client("default") || !getBucketConfig("default").bucket) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[OCR Debug] S3 frame upload skipped: missing AWS/S3 env configuration");
    }
    return null;
  }

  const safeSecond = Number.isFinite(timestamp) ? Math.max(0, Math.round(timestamp)) : 0;
  const key = `frames/${assetId}/${safeSecond}.png`;
  const body = await readFile(localPath);
  return uploadPublicObject({
    key,
    body,
    contentType: "image/png",
  });
}

export async function uploadTrimmedClipObject(args: {
  key: string;
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
}): Promise<string | null> {
  return uploadPublicObject({
    key: args.key,
    body: args.body,
    contentType: args.contentType ?? "video/mp4",
    cacheControl: args.cacheControl,
    bucketTarget: "trimmed_clips",
  });
}
