import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { isSelfHosted } from "@/lib/config/mode";
import { JobType } from "@prisma/client";
import { requireProjectOwner } from "@/lib/requireProjectOwner";

export async function POST(req: Request) {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.clone().json().catch(() => ({}));
  if ((body as { trigger?: string })?.trigger === "cron") {
    return NextResponse.json({ queued: false, reason: "cron_not_activated" }, { status: 202 });
  }

  const parsedBody = await req.json();
  const { projectId, industryCode } = parsedBody as {
    projectId?: string;
    industryCode?: string;
  };

  if (!projectId || !industryCode) {
    return NextResponse.json(
      { error: "Missing projectId or industryCode" },
      { status: 400 }
    );
  }

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const idempotencyKey = JSON.stringify([
    projectId,
    JobType.AD_PERFORMANCE,
    industryCode,
  ]);

  const existing = await prisma.job.findFirst({
    where: { idempotencyKey, projectId, userId },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ jobId: existing.id }, { status: 200 });
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      userId,
      type: JobType.AD_PERFORMANCE,
      status: "PENDING",
      idempotencyKey,
      payload: {
        industryCode,
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
