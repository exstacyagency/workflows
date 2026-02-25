import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { cfg } from "@/lib/config";

const defaultBucket = cfg.raw("AWS_S3_BUCKET") || cfg.raw("S3_MEDIA_BUCKET");
const defaultRegion = cfg.raw("AWS_S3_REGION") || cfg.raw("S3_MEDIA_REGION");
const defaultEndpoint = cfg.raw("AWS_S3_ENDPOINT") || cfg.raw("S3_MEDIA_ENDPOINT");
const accessKeyId = cfg.raw("AWS_ACCESS_KEY_ID") || cfg.raw("S3_ACCESS_KEY_ID");
const secretAccessKey = cfg.raw("AWS_SECRET_ACCESS_KEY") || cfg.raw("S3_SECRET_ACCESS_KEY");

const productSetupBucket =
  cfg.raw("AWS_S3_BUCKET_PRODUCT_SETUP") || cfg.raw("S3_BUCKET_PRODUCT_SETUP");
const productSetupRegion =
  cfg.raw("AWS_S3_REGION_PRODUCT_SETUP") || cfg.raw("S3_PRODUCT_SETUP_REGION") || defaultRegion;
const productSetupEndpoint =
  cfg.raw("AWS_S3_ENDPOINT_PRODUCT_SETUP") || cfg.raw("S3_PRODUCT_SETUP_ENDPOINT") || defaultEndpoint;
const productSetupPublicBaseUrl = cfg.raw("S3_PRODUCT_SETUP_PUBLIC_BASE_URL");

type BucketTarget = "default" | "product_setup";

type BucketConfig = {
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  publicBaseUrl: string | null;
};

const BUCKETS: Record<BucketTarget, BucketConfig> = {
  default: {
    bucket: defaultBucket,
    region: defaultRegion,
    endpoint: defaultEndpoint,
    publicBaseUrl: null,
  },
  product_setup: {
    bucket: productSetupBucket,
    region: productSetupRegion,
    endpoint: productSetupEndpoint,
    publicBaseUrl: productSetupPublicBaseUrl,
  },
};

const s3Clients = new Map<string, S3Client>();
let warnedMissing = false;

function getBucketConfig(target: BucketTarget): BucketConfig {
  return BUCKETS[target];
}

function getS3Client(target: BucketTarget): S3Client | null {
  const { bucket, region, endpoint } = getBucketConfig(target);
  if (!bucket || !region) return null;

  const cacheKey = `${region}|${endpoint || ""}`;
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

export async function uploadFrame(
  localPath: string,
  assetId: string,
  timestamp: number
): Promise<string | null> {
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
