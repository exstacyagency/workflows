// app/api/jobs/video-generation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../lib/prisma";
import { getSessionUserId } from "../../../../lib/getSessionUserId";
import { requireProjectOwner } from "../../../../lib/requireProjectOwner";
import { assertMinPlan, UpgradeRequiredError } from "../../../../lib/billing/requirePlan";
import { JobStatus, JobType } from "@prisma/client";

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertMinPlan(userId, "GROWTH");
  } catch (err: any) {
    if (err instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: "Upgrade required", requiredPlan: err.requiredPlan },
        { status: 402 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Billing check failed" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { projectId, scriptId } = parsed.data;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const idempotencyKey = `video-generation:${projectId}:${scriptId}`;

  const existing = await prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      idempotencyKey,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.COMPLETED] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (existing?.id) {
    return NextResponse.json({ ok: true, jobId: existing.id, reused: true }, { status: 200 });
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      status: JobStatus.PENDING,
      idempotencyKey,
      payload: {
        projectId,
        scriptId,
        idempotencyKey,
        chainNext: { type: "VIDEO_IMAGE_GENERATION" },
      },
    },
  });

  return NextResponse.json(
    { ok: true, jobId: job.id, stage: "VIDEO_PROMPTS_ENQUEUED" },
    { status: 200 },
  );
}

