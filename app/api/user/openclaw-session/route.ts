// app/api/user/openclaw-session/route.ts
// Keep this filename for now — rename to spacebot-session later
// when you update all callers

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    projectId?: string;
    agentId?: string;
  } | null;

  const projectId = String(body?.projectId ?? "").trim();
  const agentId   = String(body?.agentId ?? "creative").trim();

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

  // Session key format: {agentId}:webchat-{userId}:{projectId}
  const sessionKey = `${agentId}:webchat-${userId}:${projectId}`;

  // Keep projectAgentBinding upsert — still used by notifyAll
  await prisma.projectAgentBinding.upsert({
    where:  { projectId },
    create: { projectId },
    update: {},
  });

  // No longer writing openClawSessionKey to user row —
  // notifyAll now constructs session keys directly from userId + agentId

  return NextResponse.json({ ok: true, sessionKey, agentId });
}

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // agentId can be passed as query param: ?agentId=research
  const { searchParams } = new URL(req.url);
  const agentId   = searchParams.get("agentId") ?? "creative";
  const projectId = searchParams.get("projectId") ?? "";

  const sessionKey = projectId
    ? `${agentId}:webchat-${userId}:${projectId}`
    : `${agentId}:webchat-${userId}`;

  return NextResponse.json({ ok: true, sessionKey, agentId });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Nothing to clean up on Spacebot side — sessions are stateless keys
  return NextResponse.json({ ok: true });
}
