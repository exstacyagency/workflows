import { cfg } from "@/lib/config";
import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getSessionUserId } from "../../../../../lib/getSessionUserId";
import { requireProjectOwner404 } from "../../../../../lib/auth/requireProjectOwner404";
import { JobType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PhaseStatus = "completed" | "pending" | "running" | "needs_attention";

function phaseFromJobStatus(jobStatus?: string | null): PhaseStatus {
  const s = String(jobStatus || "").toUpperCase();
  if (s === "COMPLETED") return "completed";
  if (s === "RUNNING") return "running";
  if (s === "FAILED") return "needs_attention";
  return "pending";
}

async function latestJob(projectId: string, typeKeys: string[]) {
  // Query without enum IN to avoid DB/client enum drift causing hard 500s.
  // We'll filter in-memory instead.
  const jobs = await prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, type: true, status: true, updatedAt: true, resultSummary: true, error: true },
  });

  const allowed = new Set(typeKeys);
  return jobs.find((j) => allowed.has(String(j.type)));
}

export async function GET(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const url = new URL(req.url);
    const wantDebug = url.searchParams.get("debug") === "1";
    const allowDebug = cfg().raw("NODE_ENV") !== "production";
    const debugEnabled = wantDebug && allowDebug;
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const projectId = String(params.projectId || "");
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    const storyboards = await prisma.storyboard.findMany({
      where: { projectId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const storyboardIds = storyboards.map((s) => s.id);

    const jobsForProject = await prisma.job.findMany({
      where: { projectId },
      select: { payload: true, type: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const storyboardIdsFromJobs = jobsForProject
      .map((j) => {
        const p: any = j.payload ?? {};
        return p.storyboardId || p.storyboardID || p.storyboard?.id || null;
      })
      .filter((v) => typeof v === "string" && v.length > 0);

    // Also include any storyboardIds that already have scenes (direct truth).
    // Avoid Prisma `distinct` here (can be brittle across adapters); do it in JS.
    const storyboardIdsFromScenesRaw = await prisma.storyboardScene.findMany({
      select: { storyboardId: true },
      where: { storyboardId: { in: storyboardIds.length ? storyboardIds : undefined } },
      take: 500,
    });
    const storyboardIdsFromScenes = Array.from(
      new Set(storyboardIdsFromScenesRaw.map((r) => r.storyboardId))
    );

    const allStoryboardIds = Array.from(
      new Set([...storyboardIds, ...storyboardIdsFromJobs, ...storyboardIdsFromScenes])
    );

    // Count "completed" scenes in a schema-safe way:
    // - If status is an enum, its values are usually uppercase ("COMPLETED").
    // - If status is freeform, we still handle it.
    const completedSceneCount =
      allStoryboardIds.length > 0
        ? await prisma.storyboardScene.count({
            where: {
              storyboardId: { in: allStoryboardIds },
              OR: [{ status: "COMPLETED" as any }, { status: "completed" as any }],
            } as any,
          })
        : 0;

    const anySceneCompleted = completedSceneCount > 0;

    const phases = [
      {
        key: "research",
        label: "Research",
        job: await latestJob(projectId, ["CUSTOMER_RESEARCH", "AD_TRANSCRIPTS", "AD_PERFORMANCE"]),
      },
      {
        key: "avatar_product_intel",
        label: "Avatar & Product Intel",
        job: await latestJob(projectId, ["CUSTOMER_ANALYSIS", "PRODUCT_INTELLIGENCE"]),
      },
      {
        key: "pattern_brain",
        label: "Pattern Brain",
        job: await latestJob(projectId, ["PATTERN_ANALYSIS"]),
      },
      {
        key: "script_characters",
        label: "Script & Characters",
        job: await latestJob(projectId, ["SCRIPT_GENERATION", "CHARACTER_GENERATION"]),
      },
      {
        key: "storyboards_frames",
        label: "Storyboards",
        job: await latestJob(projectId, ["STORYBOARD_GENERATION", "VIDEO_PROMPT_GENERATION"]),
      },
      {
        key: "scenes_review",
        label: "Scenes & Review",
        job: await latestJob(projectId, ["VIDEO_IMAGE_GENERATION", "VIDEO_REVIEW"]),
      },
      {
        key: "upscale_export",
        label: "Upscale & Export",
        job: await latestJob(projectId, ["VIDEO_UPSCALER", "VIDEO_GENERATION"]),
      },
    ].map((p) => {
      const base = phaseFromJobStatus(p.job?.status);
      const status =
        p.key === "scenes_review"
          ? base === "needs_attention"
            ? "needs_attention"
            : anySceneCompleted
              ? "completed"
              : base
          : base;

      return {
        key: p.key,
        label: p.label,
        status,
        lastJob: p.job
          ? {
              id: p.job.id,
              type: p.job.type,
              status: p.job.status,
              updatedAt: p.job.updatedAt.toISOString(),
              resultSummary: p.job.resultSummary,
              error: p.job.error,
            }
          : null,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        projectId,
        anySceneCompleted,
        phases,
        ...(debugEnabled
          ? {
              debug: {
                storyboardIdsCount: storyboardIds.length,
                storyboardIdsFromJobsCount: storyboardIdsFromJobs.length,
                storyboardIdsFromScenesCount: storyboardIdsFromScenes.length,
                allStoryboardIdsCount: allStoryboardIds.length,
                completedSceneCount,
                sampleStoryboardIds: allStoryboardIds.slice(0, 10),
              },
            }
          : {}),
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const isDev = cfg().raw("NODE_ENV") !== "production";
    return NextResponse.json(
      { ok: false, error: msg, ...(isDev ? { stack: String(e?.stack || "") } : {}) },
      { status: 500 }
    );
  }
}
// jt() no longer needed
