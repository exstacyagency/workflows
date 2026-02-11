import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { cfg } from "@/lib/config";

const bucket = cfg.raw("AWS_S3_BUCKET") || cfg.raw("S3_MEDIA_BUCKET");
const region = cfg.raw("AWS_S3_REGION") || cfg.raw("S3_MEDIA_REGION");
const endpoint = cfg.raw("AWS_S3_ENDPOINT") || cfg.raw("S3_MEDIA_ENDPOINT");
const accessKeyId = cfg.raw("AWS_ACCESS_KEY_ID") || cfg.raw("S3_ACCESS_KEY_ID");
const secretAccessKey = cfg.raw("AWS_SECRET_ACCESS_KEY") || cfg.raw("S3_SECRET_ACCESS_KEY");

let s3Client: S3Client | null = null;
let warnedMissing = false;

function getS3Client(): S3Client | null {
  if (!bucket || !region) return null;
  if (!s3Client) {
    s3Client = new S3Client({
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
  }
  return s3Client;
}

function buildPublicUrl(key: string): string {
  if (endpoint) {
    const trimmed = endpoint.replace(/\/+$/, "");
    return `${trimmed}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function uploadFrame(
  localPath: string,
  assetId: string,
  timestamp: number
): Promise<string | null> {
  const client = getS3Client();
  if (!client || !bucket) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[OCR Debug] S3 frame upload skipped: missing AWS/S3 env configuration");
    }
    return null;
  }

  const safeSecond = Number.isFinite(timestamp) ? Math.max(0, Math.round(timestamp)) : 0;
  const key = `frames/${assetId}/${safeSecond}.png`;
  const body = await readFile(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/png",
    })
  );

  return buildPublicUrl(key);
}
