import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { checkRateLimit } from "@/lib/rateLimiter";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, jobId } = params;
  if (!projectId || !jobId) {
    return NextResponse.json({ error: "projectId and jobId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const rate = await checkRateLimit(`deadletter:retry:${userId}`, {
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.reason ?? "Rate limit exceeded" }, { status: 429 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, payload: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload: any = job.payload ?? {};
  const now = Date.now();

  if (job.status === JobStatus.PENDING) {
    const nextRunAt = payload?.nextRunAt;
    const nextRunAtNum = typeof nextRunAt === "number" ? nextRunAt : Number(nextRunAt);
    if (!nextRunAtNum || Number.isNaN(nextRunAtNum) || nextRunAtNum <= now) {
      return NextResponse.json(
        { error: "Job is already pending and not in backoff" },
        { status: 409 }
      );
    }
  } else if (job.status !== JobStatus.FAILED) {
    return NextResponse.json(
      { error: "Job is not retryable in current status" },
      { status: 409 }
    );
  }

  payload.dismissed = false;
  payload.nextRunAt = now - 1000;

  try {
    await updateJobStatus(jobId, JobStatus.PENDING);
  } catch (err) {
    return NextResponse.json({ error: "Invalid job state transition" }, { status: 409 });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      error: Prisma.JsonNull,
      payload,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
