import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  const session = await requireSession(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, jobId } = params;
  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId, userId: session.user.id },
    select: { id: true, runId: true, type: true, resultSummary: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.type !== "CUSTOMER_ANALYSIS") {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  const summary = (job.resultSummary ?? {}) as Record<string, unknown>;
  const avatarId = typeof summary.avatarId === "string" ? summary.avatarId : null;

  if (!avatarId) {
    return NextResponse.json({ error: "No avatar found for job" }, { status: 404 });
  }

  const avatar = await prisma.customerAvatar.findFirst({
    where: { id: avatarId, projectId },
    select: { id: true, persona: true, createdAt: true },
  });

  if (!avatar) {
    return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    runId: job.runId,
    avatarId: avatar.id,
    createdAt: avatar.createdAt,
    persona: avatar.persona,
  });
}
