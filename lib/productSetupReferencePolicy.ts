import { cfg } from "@/lib/config";

const productSetupBucket =
  cfg.raw("AWS_S3_BUCKET_PRODUCT_SETUP") || cfg.raw("S3_BUCKET_PRODUCT_SETUP");
const productSetupRegion =
  cfg.raw("AWS_S3_REGION_PRODUCT_SETUP") ||
  cfg.raw("S3_PRODUCT_SETUP_REGION") ||
  cfg.raw("AWS_S3_REGION") ||
  cfg.raw("S3_MEDIA_REGION");
const productSetupEndpoint =
  cfg.raw("AWS_S3_ENDPOINT_PRODUCT_SETUP") || cfg.raw("S3_PRODUCT_SETUP_ENDPOINT");
const explicitPublicBaseUrl = cfg.raw("S3_PRODUCT_SETUP_PUBLIC_BASE_URL");

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getProductSetupPublicBaseUrl(): string {
  if (explicitPublicBaseUrl) {
    return trimTrailingSlash(explicitPublicBaseUrl);
  }
  if (!productSetupBucket) {
    throw new Error(
      "Missing AWS_S3_BUCKET_PRODUCT_SETUP configuration for product setup reference images.",
    );
  }
  if (productSetupEndpoint) {
    const endpoint = trimTrailingSlash(productSetupEndpoint);
    return `${endpoint}/${productSetupBucket}`;
  }
  if (!productSetupRegion) {
    throw new Error(
      "Missing AWS_S3_REGION (or S3_PRODUCT_SETUP_REGION) for product setup reference images.",
    );
  }
  return `https://${productSetupBucket}.s3.${productSetupRegion}.amazonaws.com`;
}

export function isProductSetupReferenceUrl(url: string): boolean {
  try {
    const expectedBase = new URL(getProductSetupPublicBaseUrl());
    const candidate = new URL(url);
    if (expectedBase.protocol !== candidate.protocol) return false;
    if (expectedBase.hostname !== candidate.hostname) return false;
    if (expectedBase.port !== candidate.port) return false;

    const expectedPath = trimTrailingSlash(expectedBase.pathname);
    const candidatePath = candidate.pathname;
    if (!expectedPath || expectedPath === "/") return true;
    return candidatePath === expectedPath || candidatePath.startsWith(`${expectedPath}/`);
  } catch {
    return false;
  }
}

export function assertProductSetupReferenceUrl(url: string, fieldName: string): void {
  if (!isProductSetupReferenceUrl(url)) {
    throw new Error(
      `${fieldName} must be hosted in AWS_S3_BUCKET_PRODUCT_SETUP and publicly accessible.`,
    );
  }
}

export async function assertProductSetupReferenceReachable(
  url: string,
  fieldName: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`${fieldName} is not publicly reachable (HTTP ${res.status}).`);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`${fieldName} timed out while validating public access.`);
    }
    throw new Error(
      `${fieldName} could not be fetched from AWS_S3_BUCKET_PRODUCT_SETUP.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

