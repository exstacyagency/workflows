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

export async function PATCH(
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
    const characterId =
      typeof (body as any)?.characterId === "string"
        ? (body as any).characterId.trim()
        : "";
    const name =
      typeof (body as any)?.name === "string"
        ? (body as any).name.trim()
        : "";

    if (!characterId) {
      return NextResponse.json(
        { error: "characterId is required" },
        { status: 400 },
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    if (name.length > 120) {
      return NextResponse.json(
        { error: "name must be 120 characters or fewer" },
        { status: 400 },
      );
    }

    const character = await prisma.character.findFirst({
      where: {
        id: characterId,
        productId: params.productId,
      },
      select: { id: true },
    });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const updated = await prisma.character.update({
      where: { id: characterId },
      data: { name },
      select: { id: true, name: true },
    });

    return NextResponse.json({ success: true, character: updated });
  } catch (error) {
    console.error("[rename-character] Error:", error);
    return NextResponse.json(
      { error: "Failed to update character" },
      { status: 500 },
    );
  }
}
