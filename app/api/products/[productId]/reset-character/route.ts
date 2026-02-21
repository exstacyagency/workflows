import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { ensureProductTableColumns, findOwnedProductById } from "@/lib/productStore";

export async function POST(
  _req: NextRequest,
  { params }: { params: { productId: string } },
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureProductTableColumns();

    const product = await findOwnedProductById(params.productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await prisma.$executeRaw`
      UPDATE "product"
      SET
        "sora_character_id" = NULL,
        "character_reference_video_url" = NULL,
        "character_cameo_created_at" = NULL,
        "updated_at" = NOW()
      WHERE "id" = ${params.productId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[reset-character] Error:", error);
    return NextResponse.json(
      { error: "Failed to reset character" },
      { status: 500 },
    );
  }
}
