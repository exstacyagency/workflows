// app/api/jobs/video-generation/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import { getSessionUserId } from "../../../../../lib/getSessionUserId";
import { JobType } from "@prisma/client";
import { requireProjectOwner } from "../../../../../lib/requireProjectOwner";
import { checkRateLimit } from "../../../../../lib/rateLimiter";

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() ?? "";
  const scriptId = req.nextUrl.searchParams.get("scriptId")?.trim() ?? "";
  if (!projectId || !scriptId) {
    return NextResponse.json({ error: "projectId and scriptId are required" }, { status: 400 });
  }

  // Ownership check: prevents cross-tenant status reads
  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit: prevents abuse/polling storms
  const rate = await checkRateLimit(`video-generation:status:${userId}:${projectId}`, {
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.reason ?? "Rate limit exceeded" }, { status: 429 });
  }

  const rootKey = `video-generation:${projectId}:${scriptId}`;
  const imageKey = `${rootKey}:images`;

  const [promptJob, imageJob] = await Promise.all([
    prisma.job.findFirst({
      where: { projectId, type: JobType.VIDEO_PROMPT_GENERATION, idempotencyKey: rootKey },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, updatedAt: true, resultSummary: true },
    }),
    prisma.job.findFirst({
      where: { projectId, type: JobType.VIDEO_IMAGE_GENERATION, idempotencyKey: imageKey },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, updatedAt: true, resultSummary: true },
    }),
  ]);

  return NextResponse.json(
    {
      projectId,
      scriptId,
      promptJob,
      imageJob,
    },
    { status: 200 },
  );
}
