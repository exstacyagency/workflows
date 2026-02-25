import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { assertProductSetupReferenceUrl } from "@/lib/productSetupReferencePolicy";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

type ProductRow = {
  id: string;
  name: string;
  productProblemSolved: string | null;
  amazonAsin: string | null;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  characterCameoCreatedAt: Date | null;
  creatorVisualPrompt: string | null;
  characterSeedVideoTaskId: string | null;
  characterSeedVideoUrl: string | null;
  characterUserName: string | null;
  characters?: Array<{
    id: string;
    name: string;
    characterUserName: string | null;
    soraCharacterId: string | null;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

const nullableUrlField = z
  .union([z.string().trim().url().max(2048), z.literal(""), z.null()])
  .optional();

const CreateProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  productProblemSolved: z.string().trim().max(500).optional(),
  amazonAsin: z.string().trim().max(64).optional(),
});

const UpdateProductSchema = z
  .object({
    productId: z.string().trim().min(1, "productId is required"),
    name: z.string().trim().min(1).max(200).optional(),
    productProblemSolved: z.string().trim().max(500).or(z.literal("")).nullable().optional(),
    amazonAsin: z.string().trim().max(64).or(z.literal("")).nullable().optional(),
    creatorReferenceImageUrl: nullableUrlField,
    productReferenceImageUrl: nullableUrlField,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.productProblemSolved !== undefined ||
      value.amazonAsin !== undefined ||
      value.creatorReferenceImageUrl !== undefined ||
      value.productReferenceImageUrl !== undefined,
    { message: "At least one field is required" },
  );

const DeleteProductSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
});

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function assertProjectOwner(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return Boolean(project);
}

async function ensureProductsTable() {
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
      "creator_visual_prompt" text,
      "character_seed_video_task_id" text,
      "character_seed_video_url" text,
      "character_user_name" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "product_project_name_unique" UNIQUE ("project_id", "name")
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "product_project_id_idx" ON "product" ("project_id");`
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "character" (
      "id" text PRIMARY KEY,
      "projectId" text,
      "productId" text,
      "jobId" text,
      "name" text NOT NULL,
      "metadata" jsonb,
      "soraCharacterId" text,
      "characterUserName" text,
      "seedVideoTaskId" text,
      "seedVideoUrl" text,
      "creatorVisualPrompt" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "character_productId_idx" ON "character" ("productId");
  `);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await ensureProductsTable();
    const products = await prisma.$queryRaw<ProductRow[]>`
      SELECT
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "creator_reference_image_url" AS "creatorReferenceImageUrl",
        "product_reference_image_url" AS "productReferenceImageUrl",
        "character_reference_video_url" AS "characterReferenceVideoUrl",
        "sora_character_id" AS "soraCharacterId",
        "character_cameo_created_at" AS "characterCameoCreatedAt",
        "creator_visual_prompt" AS "creatorVisualPrompt",
        "character_seed_video_task_id" AS "characterSeedVideoTaskId",
        "character_seed_video_url" AS "characterSeedVideoUrl",
        "character_user_name" AS "characterUserName",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "product"
      WHERE "project_id" = ${projectId}
      ORDER BY "created_at" DESC
    `;

    const productIds = products.map((p) => p.id).filter(Boolean);
    const characters = productIds.length
      ? await prisma.character.findMany({
          where: { productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            name: true,
            characterUserName: true,
            soraCharacterId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const charactersByProductId = new Map<
      string,
      Array<{
        id: string;
        name: string;
        characterUserName: string | null;
        soraCharacterId: string | null;
        createdAt: Date;
      }>
    >();
    for (const c of characters) {
      const list = charactersByProductId.get(String(c.productId ?? "")) ?? [];
      list.push({
        id: c.id,
        name: c.name,
        characterUserName: c.characterUserName ?? null,
        soraCharacterId: c.soraCharacterId ?? null,
        createdAt: c.createdAt,
      });
      charactersByProductId.set(String(c.productId ?? ""), list);
    }

    const productsWithCharacters = products.map((product) => ({
      ...product,
      characters: charactersByProductId.get(product.id) ?? [],
    }));

    return NextResponse.json({ success: true, products: productsWithCharacters }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch products", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = CreateProductSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    await ensureProductsTable();
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "name" = ${data.name}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A product with this name already exists in this project." },
        { status: 409 }
      );
    }

    const id = randomUUID();
    const inserted = await prisma.$queryRaw<ProductRow[]>`
      INSERT INTO "product" (
        "id",
        "project_id",
        "name",
        "product_problem_solved",
        "amazon_asin"
      )
      VALUES (
        ${id},
        ${projectId},
        ${data.name},
        ${data.productProblemSolved || null},
        ${data.amazonAsin || null}
      )
      RETURNING
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "creator_reference_image_url" AS "creatorReferenceImageUrl",
        "product_reference_image_url" AS "productReferenceImageUrl",
        "character_reference_video_url" AS "characterReferenceVideoUrl",
        "sora_character_id" AS "soraCharacterId",
        "character_cameo_created_at" AS "characterCameoCreatedAt",
        "creator_visual_prompt" AS "creatorVisualPrompt",
        "character_seed_video_task_id" AS "characterSeedVideoTaskId",
        "character_seed_video_url" AS "characterSeedVideoUrl",
        "character_user_name" AS "characterUserName",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
    `;
    const product = inserted[0];

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create product", error);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = UpdateProductSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await ensureProductsTable();

    const existingRows = await prisma.$queryRaw<ProductRow[]>`
      SELECT
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "creator_reference_image_url" AS "creatorReferenceImageUrl",
        "product_reference_image_url" AS "productReferenceImageUrl",
        "character_reference_video_url" AS "characterReferenceVideoUrl",
        "sora_character_id" AS "soraCharacterId",
        "character_cameo_created_at" AS "characterCameoCreatedAt",
        "creator_visual_prompt" AS "creatorVisualPrompt",
        "character_seed_video_task_id" AS "characterSeedVideoTaskId",
        "character_seed_video_url" AS "characterSeedVideoUrl",
        "character_user_name" AS "characterUserName",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "id" = ${parsed.data.productId}
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const normalizedName = normalizeNullableString(parsed.data.name);
    if (normalizedName !== undefined && !normalizedName) {
      return NextResponse.json({ error: "Product name is required" }, { status: 400 });
    }
    const nextName = normalizedName ?? existing.name;
    const normalizedProblemSolved = normalizeNullableString(parsed.data.productProblemSolved);
    const normalizedAmazonAsin = normalizeNullableString(parsed.data.amazonAsin);
    const normalizedCreatorReferenceImageUrl = normalizeNullableUrl(parsed.data.creatorReferenceImageUrl);
    const normalizedProductReferenceImageUrl = normalizeNullableUrl(parsed.data.productReferenceImageUrl);
    const nextProblemSolved =
      normalizedProblemSolved !== undefined ? normalizedProblemSolved : existing.productProblemSolved;
    const nextAmazonAsin =
      normalizedAmazonAsin !== undefined ? normalizedAmazonAsin : existing.amazonAsin;
    const nextCreatorReferenceImageUrl =
      normalizedCreatorReferenceImageUrl !== undefined
        ? normalizedCreatorReferenceImageUrl
        : existing.creatorReferenceImageUrl;
    const nextProductReferenceImageUrl =
      normalizedProductReferenceImageUrl !== undefined
        ? normalizedProductReferenceImageUrl
        : existing.productReferenceImageUrl;

    if (normalizedCreatorReferenceImageUrl !== undefined && nextCreatorReferenceImageUrl) {
      assertProductSetupReferenceUrl(
        nextCreatorReferenceImageUrl,
        "creatorReferenceImageUrl",
      );
    }
    if (normalizedProductReferenceImageUrl !== undefined && nextProductReferenceImageUrl) {
      assertProductSetupReferenceUrl(
        nextProductReferenceImageUrl,
        "productReferenceImageUrl",
      );
    }

    if (nextName !== existing.name) {
      const nameConflict = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "product"
        WHERE "project_id" = ${projectId}
          AND "name" = ${nextName}
          AND "id" <> ${existing.id}
        LIMIT 1
      `;
      if (nameConflict.length > 0) {
        return NextResponse.json(
          { error: "A product with this name already exists in this project." },
          { status: 409 }
        );
      }
    }

    const updatedRows = await prisma.$queryRaw<ProductRow[]>`
      UPDATE "product"
      SET
        "name" = ${nextName},
        "product_problem_solved" = ${nextProblemSolved},
        "amazon_asin" = ${nextAmazonAsin},
        "creator_reference_image_url" = ${nextCreatorReferenceImageUrl},
        "product_reference_image_url" = ${nextProductReferenceImageUrl},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "project_id" = ${projectId}
        AND "id" = ${existing.id}
      RETURNING
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "creator_reference_image_url" AS "creatorReferenceImageUrl",
        "product_reference_image_url" AS "productReferenceImageUrl",
        "character_reference_video_url" AS "characterReferenceVideoUrl",
        "sora_character_id" AS "soraCharacterId",
        "character_cameo_created_at" AS "characterCameoCreatedAt",
        "creator_visual_prompt" AS "creatorVisualPrompt",
        "character_seed_video_task_id" AS "characterSeedVideoTaskId",
        "character_seed_video_url" AS "characterSeedVideoUrl",
        "character_user_name" AS "characterUserName",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
    `;
    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, product: updated }, { status: 200 });
  } catch (error) {
    console.error("Failed to update product", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to update product";
    const status =
      message.includes("must be hosted in AWS_S3_BUCKET_PRODUCT_SETUP") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = DeleteProductSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await ensureProductsTable();

    const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
      DELETE FROM "product"
      WHERE "project_id" = ${projectId}
        AND "id" = ${parsed.data.productId}
      RETURNING "id"
    `;

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, productId: deleted[0].id }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete product", error);
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
