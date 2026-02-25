import { prisma } from "@/lib/prisma";
import { ensureProductTableColumns } from "@/lib/productStore";

export type ProductCharacterState = {
  id: string;
  name: string;
  projectId: string;
  creatorReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  creatorVisualPrompt: string | null;
  characterSeedVideoTaskId: string | null;
  characterSeedVideoUrl: string | null;
  characterUserName: string | null;
  characterAnchorPrompt: string | null;
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
          p."name",
          p."project_id" AS "projectId",
          p."creator_reference_image_url" AS "creatorReferenceImageUrl",
          p."character_reference_video_url" AS "characterReferenceVideoUrl",
          p."sora_character_id" AS "soraCharacterId",
          p."creator_visual_prompt" AS "creatorVisualPrompt",
          p."character_seed_video_task_id" AS "characterSeedVideoTaskId",
          p."character_seed_video_url" AS "characterSeedVideoUrl",
          p."character_user_name" AS "characterUserName",
          p."character_anchor_prompt" AS "characterAnchorPrompt"
        FROM "product" p
        WHERE p."id" = ${productId}
          AND p."project_id" = ${projectId}
        LIMIT 1
      `
    : await prisma.$queryRaw<ProductCharacterState[]>`
        SELECT
          p."id",
          p."name",
          p."project_id" AS "projectId",
          p."creator_reference_image_url" AS "creatorReferenceImageUrl",
          p."character_reference_video_url" AS "characterReferenceVideoUrl",
          p."sora_character_id" AS "soraCharacterId",
          p."creator_visual_prompt" AS "creatorVisualPrompt",
          p."character_seed_video_task_id" AS "characterSeedVideoTaskId",
          p."character_seed_video_url" AS "characterSeedVideoUrl",
          p."character_user_name" AS "characterUserName",
          p."character_anchor_prompt" AS "characterAnchorPrompt"
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

export async function saveCharacterAnchorPrompt(productId: string, prompt: string) {
  await ensureProductCharacterColumns();
  await prisma.$executeRaw`
    UPDATE "product"
    SET "character_anchor_prompt" = ${prompt}, "updated_at" = NOW()
    WHERE "id" = ${productId}
  `;
}

export async function saveCharacterAvatarImage(
  productId: string,
  args: { taskId: string; imageUrl: string | null },
) {
  await ensureProductCharacterColumns();
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "character_avatar_image_url" text;
  `);
  await prisma.$executeRaw`
    UPDATE "product"
    SET
      "character_seed_video_task_id" = ${args.taskId},
      "character_avatar_image_url" = ${args.imageUrl},
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

export async function saveCharacterToTable({
  productId,
  runId,
  name,
  soraCharacterId,
  characterUserName,
  seedVideoTaskId,
  seedVideoUrl,
  creatorVisualPrompt,
}: {
  productId: string;
  runId?: string | null;
  name: string;
  soraCharacterId: string;
  characterUserName: string;
  seedVideoTaskId?: string;
  seedVideoUrl?: string;
  creatorVisualPrompt?: string;
}) {
  const productRow = await prisma.$queryRaw<Array<{ projectId: string }>>`
    SELECT "project_id" AS "projectId"
    FROM "product"
    WHERE "id" = ${productId}
    LIMIT 1
  `;
  const projectId = productRow[0]?.projectId ?? null;

  await prisma.character.create({
    data: {
      productId,
      projectId,
      runId: runId ?? null,
      name,
      soraCharacterId,
      characterUserName,
      seedVideoTaskId: seedVideoTaskId ?? null,
      seedVideoUrl: seedVideoUrl ?? null,
      creatorVisualPrompt: creatorVisualPrompt ?? null,
    },
  });
}

export async function getCharactersForProject(projectId: string) {
  return prisma.$queryRaw<Array<{
    id: string;
    productId: string | null;
    name: string;
    soraCharacterId: string | null;
    characterUserName: string | null;
    seedVideoTaskId: string | null;
    seedVideoUrl: string | null;
    creatorVisualPrompt: string | null;
    createdAt: Date;
    updatedAt: Date;
    productName: string | null;
  }>>`
    SELECT
      c."id",
      c."productId",
      c."name",
      c."soraCharacterId",
      c."characterUserName",
      c."seedVideoTaskId",
      c."seedVideoUrl",
      c."creatorVisualPrompt",
      c."createdAt",
      c."updatedAt",
      p."name" AS "productName"
    FROM "character" c
    LEFT JOIN "product" p ON p."id" = c."productId"
    WHERE p."project_id" = ${projectId}
       OR c."projectId" = ${projectId}
    ORDER BY c."createdAt" ASC
  `;
}
