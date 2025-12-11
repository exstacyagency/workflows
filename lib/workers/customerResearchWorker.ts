import { getQueue, QueueName } from '@/lib/queue';
import { runCustomerResearch } from '@/services/customerResearchService';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';

const queue = getQueue(QueueName.CUSTOMER_RESEARCH);

queue.process(async (job) => {
  const { jobId, projectId, businessIdentifier } = job.data;

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING },
    });

    job.progress(10);

    const result = await runCustomerResearch({
      projectId,
      businessIdentifier,
    });

    job.progress(90);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Research complete: ${result.totalRows} rows collected`,
      },
    });

    job.progress(100);

    return result;
  } catch (err: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: err.message,
      },
    });
    throw err;
  }
});

console.log(`[Worker] Customer Research worker started`);
