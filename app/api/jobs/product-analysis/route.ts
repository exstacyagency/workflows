// app/api/jobs/product-analysis/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from '@prisma/client';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { randomUUID } from 'crypto';

const ProductAnalysisSchema = ProjectJobSchema.extend({
  runId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, ProductAnalysisSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }

    const { projectId: parsedProjectId, runId } = parsed.data;
    projectId = parsedProjectId;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Get runId from request or find most recent completed product data collection job
    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const latestCollection = await prisma.job.findFirst({
        where: {
          projectId,
          type: 'PRODUCT_DATA_COLLECTION' as any,
          status: JobStatus.COMPLETED,
          runId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { runId: true },
      });
      effectiveRunId = latestCollection?.runId ?? undefined;
    }

    if (!effectiveRunId) {
      return NextResponse.json(
        { error: 'No completed product data collection job found. Please run product data collection first.' },
        { status: 400 }
      );
    }

    const idempotencyKey = randomUUID();

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: 'PRODUCT_ANALYSIS' as any,
          status: JobStatus.PENDING,
          idempotencyKey,
          runId: effectiveRunId,
          payload: parsed.data,
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
        select: { id: true },
      });
      jobId = job.id;
      await logAudit({
        userId,
        projectId,
        jobId,
        action: "job.create",
        ip,
        metadata: { type: "product-analysis", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, runId: effectiveRunId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
      );
    }

    if (cfg.raw("NODE_ENV") === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: 'PRODUCT_ANALYSIS' as any,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload: { ...parsed.data, idempotencyKey },
      },
    });
    jobId = job.id;

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'product-analysis',
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: true },
      { status: 202 },
    );
  } catch (err: any) {
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'product-analysis',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
