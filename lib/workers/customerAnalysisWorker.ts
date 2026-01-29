// lib/workers/customerAnalysisWorker.ts
import { getQueue, QueueName } from '../queue';
import { runCustomerAnalysis } from '../customerAnalysisService';
import prisma from '../prisma';
import { JobStatus } from '@prisma/client';
import { updateJobStatus } from '../jobs/updateJobStatus';

const queue = getQueue(QueueName.CUSTOMER_ANALYSIS);

queue.process(async (job) => {
  const { jobId, projectId, productName, productProblemSolved } = job.data;

  try {
    await updateJobStatus(jobId, JobStatus.RUNNING);

    job.progress(10);

    const result = await runCustomerAnalysis({
      projectId,
      jobId,
      productName,
      productProblemSolved,
    });

    job.progress(90);

    const avatar = result.summary?.avatar;
    const product = result.summary?.product;
    const parts: string[] = [];
    if (avatar?.primaryPain) {
      parts.push(`Avatar pain: ${avatar.primaryPain}`);
    }
    if (product?.heroIngredient) {
      parts.push(`Hero ingredient: ${product.heroIngredient}`);
    }
    const summary = parts.length
      ? `Customer analysis complete for ${result.productName}. ${parts.join(' | ')}`
      : `Customer analysis complete for ${result.productName}.`;

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: { resultSummary: summary },
    });

    job.progress(100);

    return result;
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: { error: err.message },
    });
    throw err;
  }
});

console.log(`[Worker] Customer Analysis worker started`);