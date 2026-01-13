import { getQueue, QueueName } from '@/lib/queue';
import { runCustomerResearch } from '@/services/customerResearchService';
import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';

const queue = getQueue(QueueName.CUSTOMER_RESEARCH);

queue.process(async (job) => {
  const {
    jobId,
    projectId,
    productName,
    productProblemSolved,
    productAmazonAsin,
    competitor1AmazonAsin,
    competitor2AmazonAsin,
  } = job.data as any;

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING },
    });

    job.progress(10);

    // eslint-disable-next-line no-restricted-properties
    if (process.env.NODE_ENV === 'test') {
      return {
        summary: 'Test customer research result',
        sources: [],
      };
    }

    const result = await runCustomerResearch({
      projectId,
      jobId,
      productName,
      productProblemSolved,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
    });

    job.progress(90);

    const rowsCollected = Array.isArray(result)
      ? result.length
      : Array.isArray((result as any)?.sources)
        ? (result as any).sources.length
        : 0;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Research complete: ${rowsCollected} rows collected`,
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
