import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobId = params.id;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { project: true },
    });

    if (!job) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!job.project) {
      return NextResponse.json({ error: 'Job project missing' }, { status: 404 });
    }

    const auth = await requireProjectOwner(job.project.id);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let queueStatus: any = null;
    try {
      const { getJobStatus, QueueName } = await import('@/lib/queue');

      const queueMap: Record<string, any> = {
        CUSTOMER_RESEARCH: QueueName.CUSTOMER_RESEARCH,
        AD_PERFORMANCE: QueueName.AD_COLLECTION,
      };

      const queueName = queueMap[job.type];
      queueStatus = queueName ? await getJobStatus(queueName, jobId) : null;
    } catch {
      queueStatus = null;
    }

    return NextResponse.json({ job, queueStatus });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Job status failed', detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
