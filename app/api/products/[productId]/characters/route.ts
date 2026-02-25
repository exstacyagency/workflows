import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { findOwnedProductById } from "@/lib/productStore";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { productId: string } },
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const product = await findOwnedProductById(params.productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const idsRaw = Array.isArray((body as any)?.characterIds)
      ? (body as any).characterIds
      : [];
    const characterIds = idsRaw
      .map((id: unknown) => (typeof id === "string" ? id.trim() : ""))
      .filter(Boolean);

    if (characterIds.length === 0) {
      return NextResponse.json(
        { error: "characterIds is required" },
        { status: 400 },
      );
    }

    const result = await prisma.character.deleteMany({
      where: {
        id: { in: characterIds },
        productId: params.productId,
      },
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (error) {
    console.error("[delete-characters] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete characters" },
      { status: 500 },
    );
  }
}

