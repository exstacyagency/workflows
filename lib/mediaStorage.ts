// lib/mediaStorage.ts
import { cfg } from "@/lib/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = cfg.raw("S3_MEDIA_BUCKET");
const region = cfg.raw("S3_MEDIA_REGION");

let s3Client: S3Client | null = null;

function getS3() {
  if (!bucket || !region) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region,
      credentials: cfg.raw("S3_ACCESS_KEY_ID")
        ? {
            accessKeyId: cfg.raw("S3_ACCESS_KEY_ID")!,
            secretAccessKey: cfg.raw("S3_SECRET_ACCESS_KEY")!,
          }
        : undefined,
    });
  }
  return s3Client;
}

export async function getSignedMediaUrl(
  key: string | null | undefined,
  expiresInSeconds = 60 * 10,
): Promise<string | null> {
  if (!key) return null;

  const s3 = getS3();
  if (!s3 || !bucket) {
    if (cfg.raw("NODE_ENV") === "production") {
      throw new Error("S3 media signing not configured in production");
    }
    return key;
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export function buildMediaKey(parts: string[]): string {
  return parts.join("/");
}
