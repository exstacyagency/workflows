import { prisma } from "@/lib/prisma";
import { extractProductIntel } from "@/lib/productIntelService";
import { randomUUID } from "crypto";

type ProductCollectionPayload = {
  mainProductUrl?: unknown;
};

type ProductCollectionWorkerArgs = {
  projectId: string;
  jobId: string;
  payload: ProductCollectionPayload;
};

export async function runProductCollectionWorker(args: ProductCollectionWorkerArgs) {
  const { projectId, jobId, payload } = args;
  const mainProductUrl = String(payload.mainProductUrl ?? "").trim();

  if (!mainProductUrl) {
    throw new Error("Invalid payload: missing mainProductUrl");
  }

  console.log("[Product Collection] Starting for URL:", mainProductUrl);
  console.log("[Product Collection] Job:", { projectId, jobId });
  const extracted = await extractProductIntel(mainProductUrl);
  console.log("[Product Collection] Extraction complete:", {
    product_name: extracted.product_name,
    tagline: extracted.tagline,
    key_features_count: extracted.key_features.length,
    ingredients_or_specs_count: extracted.ingredients_or_specs.length,
    key_claims_count: extracted.key_claims.length,
  });

  const id = randomUUID();
  console.log("[Product Collection] Persisting ProductIntel row...");
  const inserted = await prisma.$queryRaw<Array<{ id: string; productName: string; url: string }>>`
    INSERT INTO "product_intel" (
      "id",
      "projectId",
      "jobId",
      "url",
      "productName",
      "tagline",
      "keyFeatures",
      "ingredientsOrSpecs",
      "price",
      "keyClaims",
      "targetAudience",
      "usp",
      "rawHtml",
      "createdAt"
    )
    VALUES (
      ${id},
      ${projectId},
      ${jobId},
      ${mainProductUrl},
      ${extracted.product_name},
      ${extracted.tagline},
      ${extracted.key_features}::text[],
      ${extracted.ingredients_or_specs}::text[],
      ${extracted.price},
      ${extracted.key_claims}::text[],
      ${extracted.target_audience},
      ${extracted.usp},
      ${extracted.raw_html ?? null},
      NOW()
    )
    RETURNING "id", "productName", "url"
  `;
  const record = inserted[0];
  if (!record) {
    throw new Error("Failed to persist ProductIntel record");
  }
  console.log("[Product Collection] ProductIntel row saved:", {
    productIntelId: record.id,
    productName: record.productName,
  });

  return {
    productIntelId: record.id,
    productName: record.productName,
    url: record.url,
  };
}
