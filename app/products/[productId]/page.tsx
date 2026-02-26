import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { ensureProductTableColumns } from "@/lib/productStore";
import { ProductSetupClient, type ProductSetupData } from "./ProductSetupClient";

type ProductSetupRow = {
  id: string;
  name: string;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  characterAvatarImageUrl: string | null;
  soraCharacterId: string | null;
  characterCameoCreatedAt: Date | null;
  creatorVisualPrompt: string | null;
  characterSeedVideoTaskId: string | null;
  characterSeedVideoUrl: string | null;
  characterUserName: string | null;
  projectId: string;
  projectName: string;
};

type CharacterRow = {
  id: string;
  name: string;
  characterUserName: string | null;
  soraCharacterId: string | null;
  seedVideoUrl: string | null;
  creatorVisualPrompt: string | null;
  createdAt: Date;
};

export default async function ProductSetupPage({
  params,
  searchParams,
}: {
  params: { productId: string };
  searchParams?: { runId?: string };
}) {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/api/auth/signin");
  }

  await ensureProductTableColumns();

  const rows = await prisma.$queryRaw<ProductSetupRow[]>`
    SELECT
      p."id",
      p."name",
      p."creator_reference_image_url" AS "creatorReferenceImageUrl",
      p."product_reference_image_url" AS "productReferenceImageUrl",
      p."character_reference_video_url" AS "characterReferenceVideoUrl",
      p."character_avatar_image_url" AS "characterAvatarImageUrl",
      p."sora_character_id" AS "soraCharacterId",
      p."character_cameo_created_at" AS "characterCameoCreatedAt",
      p."creator_visual_prompt" AS "creatorVisualPrompt",
      p."character_seed_video_task_id" AS "characterSeedVideoTaskId",
      p."character_seed_video_url" AS "characterSeedVideoUrl",
      p."character_user_name" AS "characterUserName",
      pr."id" AS "projectId",
      pr."name" AS "projectName"
    FROM "product" p
    INNER JOIN "project" pr ON pr."id" = p."project_id"
    WHERE p."id" = ${params.productId}
      AND pr."userId" = ${userId}
    LIMIT 1
  `;
  const product = rows[0] ?? null;

  if (!product) {
    notFound();
  }
  const runs = await prisma.researchRun.findMany({
    where: { projectId: product.projectId },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("DEBUG runs:", JSON.stringify(runs));
  console.log("DEBUG product.projectId:", product.projectId);
  const selectedRunId = searchParams?.runId?.trim() || null;

  const characters = selectedRunId
    ? ((await prisma.character.findMany({
        where: {
          productId: product.id,
          runId: selectedRunId,
        },
        select: {
          id: true,
          name: true,
          characterUserName: true,
          soraCharacterId: true,
          seedVideoUrl: true,
          creatorVisualPrompt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })) as CharacterRow[])
    : [];
  console.log("DEBUG productId:", product.id, "characters found:", characters.length);

  const setupData: ProductSetupData = {
    id: product.id,
    name: product.name,
    creatorReferenceImageUrl: product.creatorReferenceImageUrl,
    productReferenceImageUrl: product.productReferenceImageUrl,
    characterReferenceVideoUrl: product.characterReferenceVideoUrl,
    characterAvatarImageUrl: product.characterAvatarImageUrl,
    soraCharacterId: product.soraCharacterId,
    characterCameoCreatedAt: product.characterCameoCreatedAt
      ? product.characterCameoCreatedAt.toISOString()
      : null,
    creatorVisualPrompt: product.creatorVisualPrompt,
    characterSeedVideoTaskId: product.characterSeedVideoTaskId,
    characterSeedVideoUrl: product.characterSeedVideoUrl,
    characterUserName: product.characterUserName,
    characters: characters.map((char) => ({
      id: char.id,
      name: char.name,
      characterUserName: char.characterUserName,
      soraCharacterId: char.soraCharacterId,
      seedVideoUrl: char.seedVideoUrl,
      creatorVisualPrompt: char.creatorVisualPrompt,
      createdAt: char.createdAt.toISOString(),
    })),
    runs: runs.map((run) => ({ id: run.id, name: run.name })),
    selectedRunId,
    project: {
      id: product.projectId,
      name: product.projectName,
    },
  };

  return <ProductSetupClient product={setupData} />;
}
