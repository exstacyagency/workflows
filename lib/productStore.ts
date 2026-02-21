import { prisma } from "@/lib/prisma";

export type OwnedProductRow = {
  id: string;
  projectId: string;
  name: string;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  characterCameoCreatedAt: Date | null;
};

export async function ensureProductTableColumns() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "product" (
      "id" text PRIMARY KEY,
      "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "product_problem_solved" text,
      "amazon_asin" text,
      "creator_reference_image_url" text,
      "product_reference_image_url" text,
      "character_reference_video_url" text,
      "sora_character_id" text,
      "character_cameo_created_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "product_project_name_unique" UNIQUE ("project_id", "name")
    );
  `);

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "product_project_id_idx" ON "product" ("project_id");`,
  );

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "creator_reference_image_url" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "product_reference_image_url" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "character_reference_video_url" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "sora_character_id" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "character_cameo_created_at" timestamptz;
  `);
}

export async function ensureStoryboardSceneApprovalColumn() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE storyboard_scene
    ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;
  `);
}

export async function findOwnedProductById(
  productId: string,
  userId: string,
): Promise<OwnedProductRow | null> {
  const rows = await prisma.$queryRaw<OwnedProductRow[]>`
    SELECT
      p."id",
      p."project_id" AS "projectId",
      p."name",
      p."creator_reference_image_url" AS "creatorReferenceImageUrl",
      p."product_reference_image_url" AS "productReferenceImageUrl",
      p."character_reference_video_url" AS "characterReferenceVideoUrl",
      p."sora_character_id" AS "soraCharacterId",
      p."character_cameo_created_at" AS "characterCameoCreatedAt"
    FROM "product" p
    INNER JOIN "project" pr ON pr."id" = p."project_id"
    WHERE p."id" = ${productId}
      AND pr."userId" = ${userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
