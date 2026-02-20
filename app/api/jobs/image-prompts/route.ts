import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = asObject(await req.json()) ?? {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const projectId = asString(body.projectId);
    const storyboardId = asString(body.storyboardId);

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!storyboardId) {
      return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
    }

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        projectId,
      },
      select: { id: true },
    });
    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard not found for project." }, { status: 404 });
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.IMAGE_PROMPT_GENERATION,
      storyboardId,
      Date.now(),
    ]);

    const job = await prisma.job.create({
      data: {
        userId,
        projectId,
        type: JobType.IMAGE_PROMPT_GENERATION,
        status: JobStatus.PENDING,
        idempotencyKey,
        payload: {
          projectId,
          storyboardId,
          idempotencyKey,
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ jobId: job.id, queued: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create image prompt generation job" },
      { status: 500 },
    );
  }
}
