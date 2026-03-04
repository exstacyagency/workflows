import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AdPlatform, JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const projectId = asString((body as any)?.projectId);
    const runId = asString((body as any)?.runId);
    const transcript = asString((body as any)?.transcript);
    const title = asString((body as any)?.title) || "Manual swipe template";

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }
    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }
    if (!transcript || transcript.length < 100) {
      return NextResponse.json(
        { error: "Transcript must be at least 100 characters." },
        { status: 400 },
      );
    }

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const run = await prisma.research_run.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true },
    });
    if (!run || run.projectId !== projectId) {
      return NextResponse.json({ error: "runId not found for this project" }, { status: 400 });
    }

    const fingerprint = crypto
      .createHash("sha256")
      .update(`${projectId}:${runId}:${transcript}`)
      .digest("hex")
      .slice(0, 16);

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        runId,
        type: JobType.AD_PERFORMANCE,
        status: JobStatus.COMPLETED,
        idempotencyKey: `manual-swipe-template:${projectId}:${runId}:${fingerprint}:${Date.now()}`,
        payload: {
          projectId,
          runId,
          source: "manual_swipe_transcript",
          title,
          transcriptLength: transcript.length,
        } as any,
        resultSummary: `Manual swipe transcript template added (${transcript.length} chars)`,
      },
      select: { id: true },
    });

    const adAsset = await prisma.adAsset.create({
      data: {
        projectId,
        jobId: job.id,
        platform: AdPlatform.TIKTOK,
        contentViable: true,
        swipeCandidate: true,
        isSwipeFile: true,
        swipeMetadata: {
          adMechanism: "manual_transcript_template",
          mechanismDescription: "User-uploaded transcript template.",
          hookPattern: "{hook}",
          closingPattern: "{closing}",
          problemPattern: null,
          solutionPattern: null,
          ctaPattern: null,
          beatStructure: [],
          source: "manual_upload",
        } as any,
        rawJson: {
          title,
          ad_title: title,
          transcript,
          transcriptText: transcript,
          contentViable: true,
          qualityGate: {
            viable: true,
            confidence: 1,
          },
          source: "manual_swipe_transcript",
          uploadedAt: new Date().toISOString(),
          metrics: {
            views: null,
            engagement_score: null,
            retention_3s: null,
            retention_10s: null,
            ctr: null,
          },
        } as any,
      },
      select: { id: true },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        adAssetId: adAsset.id,
      },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message ?? error ?? "Failed to upload script template transcript") },
      { status: 500 },
    );
  }
}

