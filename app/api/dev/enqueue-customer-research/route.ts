import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { JobStatus, JobType } from "@prisma/client";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

type InputBody = {
  projectId?: string;
  productName?: string;
  productProblemSolved?: string;
  mainProductAsin?: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
  competitor3Asin?: string;
};

export async function POST(req: NextRequest) {
  if (cfg.raw("NODE_ENV") === "production" || cfg.raw("DISABLE_DEV_ADMIN") === "true") {
    return new NextResponse(null, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: InputBody = {};
  try {
    body = (await req.json()) as InputBody;
  } catch {}

  const projectId = body.projectId ?? "proj_test";
  const productName = body.productName ?? "Test Product";
  const productProblemSolved = body.productProblemSolved ?? "Test problem";
  const mainProductAsin = body.mainProductAsin ?? "B0TESTASIN1";
  const competitor1Asin = body.competitor1Asin;
  const competitor2Asin = body.competitor2Asin;
  const competitor3Asin = body.competitor3Asin;

  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, name: true, description: true },
  });
  if (existing && existing.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.project.upsert({
    where: { id: projectId },
    update: {
      name: existing?.name ?? "Test Project",
      description: existing?.description ?? null,
      userId,
    },
    create: {
      id: projectId,
      name: "Test Project",
      userId,
    },
    select: { id: true },
  });

  const job = await prisma.job.create({
    data: {
      projectId,
      userId,
      type: JobType.CUSTOMER_RESEARCH,
      status: JobStatus.PENDING,
      idempotencyKey: randomUUID(),
      payload: {
        projectId,
        productName,
        productProblemSolved,
        mainProductAsin,
        competitor1Asin,
        competitor2Asin,
        competitor3Asin,
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, jobId: job.id, projectId }, { status: 200 });
}
