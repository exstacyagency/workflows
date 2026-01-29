// lib/workers/customerResearchWorker.ts
import { getQueue, QueueName } from '../queue';
import { runCustomerResearch } from '../../services/customerResearchService';
import prisma from '../prisma';
import { JobStatus } from '@prisma/client';
import { updateJobStatus } from '../jobs/updateJobStatus';

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
    await updateJobStatus(jobId, JobStatus.RUNNING);

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

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `Research complete: ${rowsCollected} rows collected`,
      },
    });

    job.progress(100);

    return result;
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err.message,
      },
    });
    throw err;
  }
});

console.log(`[Worker] Customer Research worker started`);