// lib/workers/customerAnalysisWorker.ts
import { getQueue, QueueName } from '../queue';
import { runCustomerAnalysis } from '../customerAnalysisService';
import prisma from '../prisma';
import { JobStatus } from '@prisma/client';
import { updateJobStatus } from '../jobs/updateJobStatus';

const queue = getQueue(QueueName.CUSTOMER_ANALYSIS);

queue.process(async (job) => {
  const {
    jobId,
    projectId,
    productProblemSolved,
    solutionKeywords,
    additionalProblems,
    runId,
  } = job.data;

  try {
    await updateJobStatus(jobId, JobStatus.RUNNING);

    job.progress(10);

    const result = await runCustomerAnalysis({
      projectId,
      jobId,
      productProblemSolved,
      solutionKeywords,
      additionalProblems,
      runId,
    });

    job.progress(90);

    const avatar = result.summary?.avatar;
    const parts: string[] = [];
    if (avatar?.primaryPain) {
      parts.push(`Avatar pain: ${avatar.primaryPain}`);
    }
    const problemLabel = result.productProblemSolved || "selected problem";
    const summary = parts.length
      ? `Customer analysis complete for ${problemLabel}. ${parts.join(' | ')}`
      : `Customer analysis complete for ${problemLabel}.`;

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: {
          summary,
          avatarId: result.avatarId,
          runId: result.runId ?? null,
          analysisInput: (result as any).analysisInput ?? null,
        },
      },
    });

    job.progress(100);

    return result;
  } catch (error: any) {
    console.error('[Customer Analysis Worker] ERROR:', error);
    console.error('[Customer Analysis Worker] Error stack:', error?.stack);
    console.error('[Customer Analysis Worker] Error details:', JSON.stringify(error, null, 2));
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: { error: error?.message ?? String(error) },
    });
    throw new Error(`Anthropic request failed: ${error?.message || error}`);
  }
});

console.log(`[Worker] Customer Analysis worker started`);
