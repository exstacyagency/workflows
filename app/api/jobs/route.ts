import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const projectId = typeof (body as any).projectId === "string" ? (body as any).projectId.trim() : "";
  const pipeline = typeof (body as any).pipeline === "string" ? (body as any).pipeline.trim() : "";
  const input = typeof (body as any).input === "object" && (body as any).input !== null ? (body as any).input : null;
  const idempotencyKey = typeof (body as any).idempotencyKey === "string" ? (body as any).idempotencyKey.trim() : "";

  const errors: string[] = [];
  if (!projectId) errors.push("projectId is required");
  if (!pipeline) errors.push("pipeline is required");
  if (!input) errors.push("input must be an object");
  if (!idempotencyKey) errors.push("idempotencyKey is required");
  if (idempotencyKey && idempotencyKey.length < 10) {
    errors.push("idempotencyKey must be at least 10 characters");
  }

  const jobType = Object.values(JobType).includes(pipeline as JobType) ? (pipeline as JobType) : null;
  if (pipeline && !jobType) {
    errors.push("pipeline must be a valid JobType");
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Invalid payload", details: errors }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const existing = await prisma.job.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      type: jobType,
      payload: input,
      status: JobStatus.PENDING,
      idempotencyKey,
    },
  });

  return NextResponse.json(job, { status: 201 });
}
