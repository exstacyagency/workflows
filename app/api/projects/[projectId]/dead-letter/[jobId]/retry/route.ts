import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { checkRateLimit } from "@/lib/rateLimiter";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rate = await checkRateLimit(`deadletter:retry:${userId}`, {
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.reason ?? "Rate limit exceeded" }, { status: 429 });
  }

  const { projectId, jobId } = params;
  const auth = await requireProjectOwner(projectId);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, payload: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload: any = job.payload ?? {};
  const now = Date.now();

  if (job.status === "PENDING") {
    const nextRunAt = payload?.nextRunAt;
    const nextRunAtNum = typeof nextRunAt === "number" ? nextRunAt : Number(nextRunAt);
    if (!nextRunAtNum || Number.isNaN(nextRunAtNum) || nextRunAtNum <= now) {
      return NextResponse.json(
        { error: "Job is already pending and not in backoff" },
        { status: 409 }
      );
    }
  } else if (job.status !== "FAILED") {
    return NextResponse.json(
      { error: "Job is not retryable in current status" },
      { status: 409 }
    );
  }

  payload.dismissed = false;
  payload.nextRunAt = now - 1000;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      error: null,
      payload,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
