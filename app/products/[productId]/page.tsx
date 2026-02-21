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
  soraCharacterId: string | null;
  characterCameoCreatedAt: Date | null;
  projectId: string;
  projectName: string;
};

export default async function ProductSetupPage({
  params,
}: {
  params: { productId: string };
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
      p."sora_character_id" AS "soraCharacterId",
      p."character_cameo_created_at" AS "characterCameoCreatedAt",
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

  const setupData: ProductSetupData = {
    id: product.id,
    name: product.name,
    creatorReferenceImageUrl: product.creatorReferenceImageUrl,
    productReferenceImageUrl: product.productReferenceImageUrl,
    characterReferenceVideoUrl: product.characterReferenceVideoUrl,
    soraCharacterId: product.soraCharacterId,
      characterCameoCreatedAt: product.characterCameoCreatedAt
        ? product.characterCameoCreatedAt.toISOString()
        : null,
    project: {
      id: product.projectId,
      name: product.projectName,
    },
  };

  return <ProductSetupClient product={setupData} />;
}
