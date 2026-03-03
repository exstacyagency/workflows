import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import prisma from "@/lib/prisma";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function buildApiKey(): { rawKey: string; prefix: string } {
  const token = randomBytes(32).toString("hex");
  const rawKey = `wk_${token}`;
  return {
    rawKey,
    prefix: rawKey.slice(0, 12),
  };
}

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.userApiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json({ ok: true, keys });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = String(body?.name ?? "Default").trim().slice(0, 64) || "Default";

  const { rawKey, prefix } = buildApiKey();
  const keyHash = hashKey(rawKey);

  const created = await prisma.userApiKey.create({
    data: {
      userId,
      name,
      keyPrefix: prefix,
      keyHash,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    apiKey: rawKey,
    key: created,
    warning: "Store this key now. It cannot be retrieved again.",
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { keyId?: string } | null;
  const keyId = String(body?.keyId ?? "").trim();
  if (!keyId) {
    return NextResponse.json({ error: "keyId required" }, { status: 400 });
  }

  const existing = await prisma.userApiKey.findFirst({
    where: { id: keyId, userId },
    select: { id: true, revokedAt: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.userApiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
