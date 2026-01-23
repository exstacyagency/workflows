// Patch 2 — Fix API guard crash during build
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function assertValidRuntimeMode(mode: string) {
  if (mode !== "alpha" && mode !== "production") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }
}

if (!isBuildPhase) {
  assertValidRuntimeMode(getRuntimeMode());
}
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { getRuntimeMode } from "@/lib/jobRuntimeMode";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { projectId, pipeline, input, idempotencyKey, status, mode } = body;

  // 🚨 HARD GUARD: production jobs forbidden in alpha
  if (getRuntimeMode() === "alpha" && mode === "production") {
    return NextResponse.json(
      { error: "Production jobs are not allowed in alpha" },
      { status: 403 }
    );
  }

  if (!projectId || !pipeline || !idempotencyKey) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Ensure project belongs to user
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

  // Allow only explicitly supported input fields
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
    // Handles race condition edge case
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
