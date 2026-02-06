// app/api/jobs/product-data-collection/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { z } from 'zod';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const ProductDataCollectionSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, 'productName is required'),
  productUrl: z.string().url('productUrl must be a valid URL'),
  competitors: z.array(z.string().url()).optional().default([]),
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
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, ProductDataCollectionSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }
    const {
      projectId: parsedProjectId,
      productId,
      productName,
      productUrl,
      competitors,
      runId,
    } = parsed.data;
    projectId = parsedProjectId;

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    if (cfg.raw("NODE_ENV") === 'production' && cfg.raw("FORCE_RATE_LIMIT") === "1") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 }
        );
      }
    }

    // Create new research run if no runId provided
    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const run = await prisma.researchRun.create({
        data: { 
          projectId, 
          status: 'IN_PROGRESS' 
        }
      });
      effectiveRunId = run.id;
    }

    const idempotencyKey = randomUUID();

    const initialPayload: any = {
      projectId,
      ...(productId && { productId }),
      productName,
      productUrl,
      competitors,
      idempotencyKey,
      skipped: securitySweep,
      reason: securitySweep ? "SECURITY_SWEEP" : null,
    };

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.PRODUCT_DATA_COLLECTION,
        status: securitySweep ? JobStatus.COMPLETED : JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload: initialPayload,
        resultSummary: securitySweep ? "Skipped: SECURITY_SWEEP" : undefined,
        error: Prisma.JsonNull,
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
        type: 'product-data-collection',
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: !securitySweep, skipped: securitySweep, reason: securitySweep ? "SECURITY_SWEEP" : null },
      { status: 200 },
    );
  } catch (error: any) {
    if (jobId) {
      try {
        await updateJobStatus(jobId, JobStatus.FAILED);
        await prisma.job.update({ where: { id: jobId }, data: { error: String(error?.message ?? error) } });
      } catch (e) {
        console.error('Failed to mark job as failed after setup error', e);
      }
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'product-data-collection',
        error: String(error?.message ?? error),
      },
    });
    console.error('[API] Product data collection job creation failed:', error);
    return NextResponse.json(
      { error: error?.message ?? 'Product data collection job creation failed' },
      { status: 500 }
    );
  }
}
