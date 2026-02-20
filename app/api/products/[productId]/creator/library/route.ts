import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CreatorLibraryRow,
  ensureCreatorLibraryTables,
  findOwnedProductById,
  toCreatorLibraryResponse,
} from "@/lib/creatorLibraryStore";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

const SetActiveSchema = z.object({
  libraryId: z.string().trim().min(1, "libraryId is required"),
});

async function loadLibraryEntries(productId: string): Promise<CreatorLibraryRow[]> {
  return prisma.$queryRaw<CreatorLibraryRow[]>`
    SELECT
      "id",
      "product_id" AS "productId",
      "image_url" AS "imageUrl",
      "prompt",
      "is_active" AS "isActive",
      "created_at" AS "createdAt"
    FROM "creator_library"
    WHERE "product_id" = ${productId}
    ORDER BY "created_at" DESC
  `;
}

export async function GET(_req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureCreatorLibraryTables();

    const product = await findOwnedProductById(params.productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const entries = await loadLibraryEntries(product.id);

    return NextResponse.json(
      {
        success: true,
        productId: product.id,
        creatorReferenceImageUrl: product.creatorReferenceImageUrl,
        entries: entries.map(toCreatorLibraryResponse),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to load creator library", error);
    return NextResponse.json({ error: "Failed to load creator library" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureCreatorLibraryTables();

    const product = await findOwnedProductById(params.productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const parsed = SetActiveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const libraryId = parsed.data.libraryId;
    const outcome = await prisma.$transaction(async (tx) => {
      const selectedRows = await tx.$queryRaw<CreatorLibraryRow[]>`
        SELECT
          "id",
          "product_id" AS "productId",
          "image_url" AS "imageUrl",
          "prompt",
          "is_active" AS "isActive",
          "created_at" AS "createdAt"
        FROM "creator_library"
        WHERE "id" = ${libraryId}
          AND "product_id" = ${product.id}
        LIMIT 1
      `;
      const selected = selectedRows[0];
      if (!selected) {
        return null;
      }

      await tx.$executeRaw`
        UPDATE "creator_library"
        SET "is_active" = false
        WHERE "product_id" = ${product.id}
      `;

      await tx.$executeRaw`
        UPDATE "creator_library"
        SET "is_active" = true
        WHERE "id" = ${libraryId}
          AND "product_id" = ${product.id}
      `;

      await tx.$executeRaw`
        UPDATE "product"
        SET
          "creator_reference_image_url" = ${selected.imageUrl},
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${product.id}
      `;

      const entries = await tx.$queryRaw<CreatorLibraryRow[]>`
        SELECT
          "id",
          "product_id" AS "productId",
          "image_url" AS "imageUrl",
          "prompt",
          "is_active" AS "isActive",
          "created_at" AS "createdAt"
        FROM "creator_library"
        WHERE "product_id" = ${product.id}
        ORDER BY "created_at" DESC
      `;

      return {
        selected,
        entries,
      };
    });

    if (!outcome) {
      return NextResponse.json({ error: "Library item not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        productId: product.id,
        creatorReferenceImageUrl: outcome.selected.imageUrl,
        activeLibraryId: outcome.selected.id,
        entries: outcome.entries.map(toCreatorLibraryResponse),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to set active creator library image", error);
    return NextResponse.json(
      { error: "Failed to set active creator image" },
      { status: 500 },
    );
  }
}
