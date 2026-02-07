import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { prisma } from "@/lib/prisma";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  const session = await requireSession(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, jobId } = params;
  const includeInputs = req.nextUrl.searchParams.get("includeInputs") === "1";
  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId, userId: session.user.id },
    select: { id: true, runId: true, type: true, resultSummary: true, payload: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.type !== "CUSTOMER_ANALYSIS") {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  const summary = (job.resultSummary ?? {}) as Record<string, unknown>;
  const avatarId = typeof summary.avatarId === "string" ? summary.avatarId : null;

  if (!avatarId) {
    return NextResponse.json({ error: "No avatar found for job" }, { status: 404 });
  }

  const avatar = await prisma.customerAvatar.findFirst({
    where: { id: avatarId, projectId },
    select: { id: true, persona: true, createdAt: true },
  });

  if (!avatar) {
    return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  }

  let analysisInputs: Record<string, unknown> | null = null;
  if (includeInputs) {
    const analysisInputMeta = (summary.analysisInput ?? {}) as Record<string, unknown>;
    const anthropicRequestLogPath =
      typeof analysisInputMeta.anthropicRequestLogPath === "string"
        ? analysisInputMeta.anthropicRequestLogPath
        : null;
    const anthropicResponseLogPath =
      typeof analysisInputMeta.anthropicResponseLogPath === "string"
        ? analysisInputMeta.anthropicResponseLogPath
        : null;

    let anthropicRequest: unknown = null;
    let error: string | null = null;
    if (anthropicRequestLogPath) {
      const logsDir = path.resolve(process.cwd(), "logs", "anthropic");
      const resolvedPath = path.resolve(anthropicRequestLogPath);
      const inLogsDir =
        resolvedPath === logsDir || resolvedPath.startsWith(`${logsDir}${path.sep}`);
      if (!inLogsDir) {
        error = "Invalid Anthropic request log path";
      } else {
        try {
          const raw = await readFile(resolvedPath, "utf8");
          anthropicRequest = JSON.parse(raw);
        } catch (readError) {
          error = `Failed to read Anthropic request log: ${String((readError as Error)?.message || readError)}`;
        }
      }
    } else {
      error = "Anthropic request log path not found for this job";
    }

    analysisInputs = {
      jobPayload: job.payload ?? null,
      anthropicRequest,
      anthropicRequestLogPath,
      anthropicResponseLogPath,
      error,
    };
  }

  return NextResponse.json({
    jobId: job.id,
    runId: job.runId,
    avatarId: avatar.id,
    createdAt: avatar.createdAt,
    persona: avatar.persona,
    ...(includeInputs ? { analysisInputs } : {}),
  });
}
