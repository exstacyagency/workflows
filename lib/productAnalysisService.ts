// lib/productAnalysisService.ts
import { prisma } from './prisma';
import { logError } from './logger';
import { JobType, JobStatus } from '@prisma/client';

interface ProductAnalysisParams {
  projectId: string;
  jobId: string;
  runId?: string;
}

export async function analyzeProductData(params: ProductAnalysisParams) {
  const { projectId, jobId, runId } = params;

  try {
    console.log(`[ProductAnalysis] Starting for job ${jobId}`);

    // Find the completed product data collection job
    let productDataCollectionJob;
    if (runId) {
      productDataCollectionJob = await prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.PRODUCT_DATA_COLLECTION,
          status: JobStatus.COMPLETED,
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      productDataCollectionJob = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.PRODUCT_DATA_COLLECTION,
          status: JobStatus.COMPLETED,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!productDataCollectionJob) {
      throw new Error('No completed product data collection job found');
    }

    // Load collected product data
    const productIntelligence = await prisma.productIntelligence.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    if (!productIntelligence) {
      throw new Error('No product data found');
    }

    // TODO: Use Claude API to analyze competitive positioning
    // For now, return placeholder analysis
    const analysis = {
      competitivePositioning: {
        strengths: ['Strength 1', 'Strength 2'],
        weaknesses: ['Weakness 1', 'Weakness 2'],
        opportunities: ['Opportunity 1', 'Opportunity 2'],
        threats: ['Threat 1', 'Threat 2'],
      },
      featureComparison: {
        uniqueFeatures: ['Unique feature 1', 'Unique feature 2'],
        missingFeatures: ['Missing feature 1'],
        competitiveAdvantages: ['Advantage 1'],
      },
      recommendations: [
        'Recommendation 1: Focus on unique features',
        'Recommendation 2: Address missing features',
        'Recommendation 3: Leverage competitive advantages',
      ],
      analyzedAt: new Date().toISOString(),
    };

    // Update ProductIntelligence with analysis
    await prisma.productIntelligence.update({
      where: { id: productIntelligence.id },
      data: {
        insights: {
          ...(productIntelligence.insights as any),
          analysis,
        },
      },
    });

    console.log(`[ProductAnalysis] Completed for job ${jobId}`);

    return {
      ok: true,
      analysis,
      productDataCollectionJobId: productDataCollectionJob.id,
    };
  } catch (error: any) {
    logError('productAnalysis.failed', error, { jobId, projectId });
    throw error;
  }
}
