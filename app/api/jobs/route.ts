// app/api/jobs/route.ts
console.log("[jobs] root handler HIT");

import { getRuntimeMode } from "@/lib/runtime/getRuntimeMode";
import { assertValidRuntimeMode } from "@/lib/runtime/assertValidRuntimeMode";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { assertRuntimeMode } from "@/lib/jobRuntimeMode";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const isBuildPhase = cfg.raw("NEXT_PHASE") === "phase-production-build";
  if (!isBuildPhase) {
    assertValidRuntimeMode();
  }

  const session = await requireSession(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json();
  const { projectId, pipeline, input, idempotencyKey, status, mode } = body;

  if (assertRuntimeMode() === "alpha" && mode === "production") {
    return NextResponse.json(
      { error: "Production jobs are not allowed in alpha" },
      { status: 403 }
    );
  }

  if (!projectId || !pipeline || !idempotencyKey) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found for user" }, { status: 400 });
  }

  if (status !== undefined) {
    return NextResponse.json(
      { error: "Status cannot be set via API" },
      { status: 400 }
    );
  }

  const safeInput =
    input && typeof input === "object"
      ? {
          ...(input.forceFailStep ? { forceFailStep: input.forceFailStep } : {}),
        }
      : {};

  try {
    const job = await prisma.$transaction(async (tx) => {
      const existing = await tx.job.findUnique({
        where: {
          userId_projectId_idempotencyKey: {
            userId,
            projectId,
            idempotencyKey,
          },
        },
      });

      if (existing) {
        return existing;
      }

      return tx.job.create({
        data: {
          projectId,
          userId,
          type: pipeline,
          payload: safeInput,
          idempotencyKey,
          status: "PENDING",
        },
      });
    });

    return NextResponse.json(job);
  } catch (err: any) {
    if (err.code === "P2002") {
      const existing = await prisma.job.findUnique({
        where: {
          userId_projectId_idempotencyKey: {
            userId,
            projectId,
            idempotencyKey,
          },
        },
      });

      if (existing) return NextResponse.json(existing);
    }

    throw err;
  }
}