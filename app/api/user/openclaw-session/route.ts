import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import prisma from "@/lib/prisma";

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

  const sessionKey = `webchat:user-${userId}:project-${projectId}`;

  await prisma.user.update({
    where: { id: userId },
    data: { openClawSessionKey: sessionKey },
  });

  await prisma.projectAgentBinding.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });

  return NextResponse.json({ ok: true, sessionKey });
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

  return NextResponse.json({ ok: true });
}
