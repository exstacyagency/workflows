// app/api/jobs/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { z } from 'zod';
import { parseJson } from '../../../../lib/validation/jobs';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const UploadJobSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  runId: z.string().optional().nullable(),
  jobType: z.enum(['CUSTOMER_RESEARCH', 'AD_PERFORMANCE', 'PRODUCT_DATA_COLLECTION']),
  data: z.any(), // Will be validated based on jobType
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, UploadJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }

    const { projectId: parsedProjectId, runId, jobType, data } = parsed.data;
    projectId = parsedProjectId;

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    // Validate data format based on job type
    const validation = validateUploadData(data, jobType);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const idempotencyKey = randomUUID();

    // Create synthetic completed job
    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: jobType as JobType,
        status: JobStatus.COMPLETED,
        idempotencyKey,
        runId: runId || null,
        payload: data,
        resultSummary: 'Uploaded by user',
        actualCost: 0,
      },
    });
    jobId = job.id;

    // Store the uploaded data based on job type
    await storeUploadedData(projectId, jobId, jobType, data);

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.upload',
      ip,
      metadata: {
        type: jobType,
        rowCount: Array.isArray(data) ? data.length : 1,
      },
    });

    return NextResponse.json(
      { success: true, jobId },
      { status: 200 }
    );
  } catch (error: any) {
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.upload.error',
      ip,
      metadata: {
        error: String(error?.message ?? error),
      },
    });
    console.error('[API] Job upload failed:', error);
    return NextResponse.json(
      { error: error?.message ?? 'Job upload failed' },
      { status: 500 }
    );
  }
}

function validateUploadData(data: any, jobType: string): { valid: boolean; error?: string } {
  if (jobType === 'CUSTOMER_RESEARCH') {
    if (!Array.isArray(data)) {
      return { valid: false, error: 'Customer research data must be an array (CSV format)' };
    }
    if (data.length === 0) {
      return { valid: false, error: 'File is empty' };
    }
    
    const requiredColumns = ['source', 'text', 'rating', 'author'];
    const columns = Object.keys(data[0] || {});
    const missing = requiredColumns.filter(col => !columns.includes(col));
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing columns: ${missing.join(', ')}. Expected: ${requiredColumns.join(', ')}`
      };
    }
  }

  if (jobType === 'AD_PERFORMANCE') {
    if (!Array.isArray(data)) {
      return { valid: false, error: 'Ad performance data must be an array (CSV format)' };
    }
    if (data.length === 0) {
      return { valid: false, error: 'File is empty' };
    }
    
    const requiredColumns = ['adId', 'platform', 'transcript', 'views'];
    const columns = Object.keys(data[0] || {});
    const missing = requiredColumns.filter(col => !columns.includes(col));
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing columns: ${missing.join(', ')}. Expected: ${requiredColumns.join(', ')}`
      };
    }
  }

  if (jobType === 'PRODUCT_DATA_COLLECTION') {
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { valid: false, error: 'Product data must be a JSON object' };
    }
    
    const requiredFields = ['productName', 'features', 'competitors'];
    const missing = requiredFields.filter(field => !(field in data));
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing fields: ${missing.join(', ')}`
      };
    }
  }

  return { valid: true };
}

async function storeUploadedData(projectId: string, jobId: string, jobType: string, data: any) {
  if (jobType === 'CUSTOMER_RESEARCH') {
    // Store in researchRow table
    const rows = data.map((row: any) => ({
      projectId,
      jobId,
      source: row.source || 'UPLOADED',
      content: row.text,
      metadata: {
        rating: row.rating,
        author: row.author,
        uploaded: true,
      },
    }));
    
    await prisma.researchRow.createMany({
      data: rows,
    });
  }

  if (jobType === 'AD_PERFORMANCE') {
    // Store in appropriate ad table
    const rows = data.map((row: any) => ({
      projectId,
      jobId,
      adId: row.adId,
      platform: row.platform,
      transcript: row.transcript,
      views: parseInt(row.views) || 0,
      metadata: {
        uploaded: true,
      },
    }));
    
    // Note: Adjust table name based on your schema
    // This is a placeholder - you'll need to use the correct table
    await prisma.$executeRaw`
      INSERT INTO ad_data (project_id, job_id, ad_id, platform, transcript, views, metadata)
      VALUES ${rows.map((r: any) => `(${r.projectId}, ${r.jobId}, ${r.adId}, ${r.platform}, ${r.transcript}, ${r.views}, ${JSON.stringify(r.metadata)})`).join(', ')}
    `;
  }

  if (jobType === 'PRODUCT_DATA_COLLECTION') {
    // Store product data in job payload
    // Note: Adjust based on your actual schema for product data storage
    // For now, the data is already stored in the job.payload field
  }
}
