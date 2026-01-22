import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, pipeline, input, idempotencyKey, status } = body;

  if (!projectId || !pipeline || !idempotencyKey) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (status !== undefined) {
    return NextResponse.json(
      { error: "Status cannot be set via API" },
      { status: 400 }
    );
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
    return NextResponse.json(
      { error: "Project access denied" },
      { status: 403 }
    );
  }

  // 🔒 TOTAL IDEMPOTENCY GUARANTEE
  try {
    const job = await prisma.$transaction(async (tx) => {
      // Always check first
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

      // Create if and only if none exists
      return await tx.job.create({
        data: {
          projectId,
          userId,
          type: pipeline,
          payload: input ?? {},
          idempotencyKey,
          status: "PENDING",
        },
      });
    });

    return NextResponse.json(job, { status: 200 });
  } catch (err: any) {
    // Absolute safety net — no Prisma error may escape
    if (err?.code === "P2002") {
      const existing = await prisma.job.findUnique({
        where: {
          userId_projectId_idempotencyKey: {
            userId,
            projectId,
            idempotencyKey,
          },
        },
      });

      if (existing) {
        return NextResponse.json(existing, { status: 200 });
      }
    }

    console.error("Job creation failed:", err);
    return NextResponse.json(
      { error: "Job creation failed" },
      { status: 500 }
    );
  }
}
