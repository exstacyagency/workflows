import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const jobId = params.id;

  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!dbJob) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const { getJobStatus, QueueName } = await import('@/lib/queue');

  const queueMap: Record<string, any> = {
    CUSTOMER_RESEARCH: QueueName.CUSTOMER_RESEARCH,
    AD_PERFORMANCE: QueueName.AD_COLLECTION,
  };

  const queueName = queueMap[dbJob.type];
  const queueStatus = queueName 
    ? await getJobStatus(queueName, jobId)
    : null;

  return NextResponse.json({
    job: dbJob,
    queue: queueStatus,
  });
}
