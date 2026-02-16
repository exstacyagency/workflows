import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { JobStatus, JobType, ScriptStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { logAudit } from "@/lib/logger";

const BodySchema = z.object({
  projectId: z.string().min(1),
  productId: z.string().min(1).optional(),
  scriptText: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { projectId, productId, scriptText } = parsed.data;
    const normalizedText = scriptText.trim();
    if (!normalizedText) {
      return NextResponse.json({ error: "scriptText is required" }, { status: 400 });
    }

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const idempotencyKey = `script-upload:${projectId}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.SCRIPT_GENERATION,
        status: JobStatus.COMPLETED,
        idempotencyKey,
        payload: {
          projectId,
          productId: productId ?? null,
          source: "manual_upload",
          scriptLength: normalizedText.length,
        },
        resultSummary: `Script uploaded manually (words=${wordCount})`,
      },
      select: { id: true },
    });

    const script = await prisma.script.create({
      data: {
        projectId,
        jobId: job.id,
        status: ScriptStatus.READY,
        wordCount,
        rawJson: {
          text: normalizedText,
          source: "manual_upload",
          uploadedAt: new Date().toISOString(),
        },
      },
      select: { id: true },
    });

    await logAudit({
      userId,
      projectId,
      jobId: job.id,
      action: "job.create",
      ip,
      metadata: {
        type: "script-upload",
        scriptId: script.id,
        wordCount,
      },
    });

    return NextResponse.json(
      { ok: true, uploaded: true, jobId: job.id, scriptId: script.id, wordCount },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/jobs/script-upload] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to upload script" },
      { status: 500 }
    );
  }
}
