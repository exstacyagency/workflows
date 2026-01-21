import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { isSelfHosted } from "@/lib/config/mode";
import { JobType } from "@prisma/client";

export async function POST(req: Request) {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { projectId, industryCode } = body as {
    projectId?: string;
    industryCode?: string;
  };

  if (!projectId || !industryCode) {
    return NextResponse.json(
      { error: "Missing projectId or industryCode" },
      { status: 400 }
    );
  }

  const idempotencyKey = JSON.stringify([
    projectId,
    JobType.AD_PERFORMANCE,
    industryCode,
  ]);

  const existing = await prisma.job.findFirst({
    where: { idempotencyKey },
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