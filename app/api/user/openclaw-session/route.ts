import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import prisma from "@/lib/prisma";

function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function getOrCreateOpenClawApiKey(userId: string): Promise<string | null> {
  // Check for existing OpenClaw key cookie — can't recover raw key from DB
  // so we create a dedicated one if none named "OpenClaw" exists
  const existing = await prisma.userApiKey.findFirst({
    where: { userId, name: "OpenClaw", revokedAt: null },
    select: { id: true },
  });
  if (existing) {
    // Raw key not recoverable — return null, client must use cookie
    return null;
  }
  const token = randomBytes(32).toString("hex");
  const rawKey = `wk_${token}`;
  await prisma.userApiKey.create({
    data: {
      userId,
      name: "OpenClaw",
      keyPrefix: rawKey.slice(0, 12),
      keyHash: hashKey(rawKey),
    },
  });
  return rawKey;
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { projectId?: string } | null;
  const projectId = String(body?.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sessionKey = `agent:main:webchat-${userId}`;
  await prisma.user.update({
    where: { id: userId },
    data: { openClawSessionKey: sessionKey },
  });
  await prisma.projectAgentBinding.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });

  const freshApiKey = await getOrCreateOpenClawApiKey(userId);

  const res = NextResponse.json({ ok: true, sessionKey, apiKey: freshApiKey });

  // Persist raw key in httpOnly cookie so subsequent sessions can read it
  if (freshApiKey) {
    res.cookies.set("openclaw_api_key", freshApiKey, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return res;
}

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Return raw key from cookie on subsequent loads
  const apiKey = req.cookies.get("openclaw_api_key")?.value ?? null;
  const sessionKey = `agent:main:webchat-${userId}`;
  return NextResponse.json({ ok: true, sessionKey, apiKey });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { openClawSessionKey: null },
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("openclaw_api_key");
  return res;
}
