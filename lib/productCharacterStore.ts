import { prisma } from "@/lib/prisma";
import { ensureProductTableColumns } from "@/lib/productStore";

export type ProductCharacterState = {
  id: string;
  projectId: string;
  creatorReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  creatorVisualPrompt: string | null;
  characterSeedVideoTaskId: string | null;
  characterSeedVideoUrl: string | null;
  characterUserName: string | null;
};

export async function ensureProductCharacterColumns() {
  await ensureProductTableColumns();
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "creator_visual_prompt" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "character_seed_video_task_id" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "character_seed_video_url" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "character_user_name" text;
  `);
}

export async function getProductCharacterState(
  productId: string,
  projectId?: string,
): Promise<ProductCharacterState | null> {
  await ensureProductCharacterColumns();
  const rows = projectId
    ? await prisma.$queryRaw<ProductCharacterState[]>`
        SELECT
          p."id",
          p."project_id" AS "projectId",
          p."creator_reference_image_url" AS "creatorReferenceImageUrl",
          p."character_reference_video_url" AS "characterReferenceVideoUrl",
          p."sora_character_id" AS "soraCharacterId",
          p."creator_visual_prompt" AS "creatorVisualPrompt",
          p."character_seed_video_task_id" AS "characterSeedVideoTaskId",
          p."character_seed_video_url" AS "characterSeedVideoUrl",
          p."character_user_name" AS "characterUserName"
        FROM "product" p
        WHERE p."id" = ${productId}
          AND p."project_id" = ${projectId}
        LIMIT 1
      `
    : await prisma.$queryRaw<ProductCharacterState[]>`
        SELECT
          p."id",
          p."project_id" AS "projectId",
          p."creator_reference_image_url" AS "creatorReferenceImageUrl",
          p."character_reference_video_url" AS "characterReferenceVideoUrl",
          p."sora_character_id" AS "soraCharacterId",
          p."creator_visual_prompt" AS "creatorVisualPrompt",
          p."character_seed_video_task_id" AS "characterSeedVideoTaskId",
          p."character_seed_video_url" AS "characterSeedVideoUrl",
          p."character_user_name" AS "characterUserName"
        FROM "product" p
        WHERE p."id" = ${productId}
        LIMIT 1
      `;
  return rows[0] ?? null;
}

export async function saveCreatorVisualPrompt(productId: string, creatorVisualPrompt: string) {
  await ensureProductCharacterColumns();
  await prisma.$executeRaw`
    UPDATE "product"
    SET
      "creator_visual_prompt" = ${creatorVisualPrompt},
      "updated_at" = NOW()
    WHERE "id" = ${productId}
  `;
}

export async function saveSeedVideoResult(
  productId: string,
  args: { taskId: string; videoUrl: string | null },
) {
  await ensureProductCharacterColumns();
  await prisma.$executeRaw`
    UPDATE "product"
    SET
      "character_seed_video_task_id" = ${args.taskId},
      "character_seed_video_url" = ${args.videoUrl},
      "character_reference_video_url" = COALESCE(${args.videoUrl}, "character_reference_video_url"),
      "updated_at" = NOW()
    WHERE "id" = ${productId}
  `;
}

export async function saveCharacterResult(
  productId: string,
  args: {
    characterId: string;
    characterUserName: string | null;
    referenceVideoUrl?: string | null;
  },
) {
  await ensureProductCharacterColumns();
  await prisma.$executeRaw`
    UPDATE "product"
    SET
      "sora_character_id" = ${args.characterId},
      "character_user_name" = ${args.characterUserName},
      "character_reference_video_url" = COALESCE(${args.referenceVideoUrl ?? null}, "character_reference_video_url"),
      "character_cameo_created_at" = NOW(),
      "updated_at" = NOW()
    WHERE "id" = ${productId}
  `;
}
