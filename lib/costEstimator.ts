import { prisma } from '@/lib/prisma';

type CostEstimate = {
  apifyCalls: number;
  apifyCost: number;
  assemblyAICalls: number;
  assemblyAICost: number;
  claudeCalls: number;
  claudeCost: number;
  totalCost: number;
  breakdown: string[];
};

const COSTS = {
  apify_reddit_search: 0.01,
  apify_reddit_scrape: 0.05,
  apify_amazon_reviews: 0.10,
  apify_tiktok_ads: 0.25,
  assemblyai_transcript: 0.00025,
  claude_sonnet_input: 0.003 / 1000,
  claude_sonnet_output: 0.015 / 1000,
  claude_opus_input: 0.015 / 1000,
  claude_opus_output: 0.075 / 1000,
};

export async function estimateCustomerResearchCost(params: {
  productAmazonAsin: string;
  competitor1AmazonAsin?: string;
  competitor2AmazonAsin?: string;
}): Promise<CostEstimate> {
  const { competitor1AmazonAsin, competitor2AmazonAsin } = params;

  const apifyCalls = 
    2 +
    2 +
    2 +
    (competitor1AmazonAsin ? 1 : 0) +
    (competitor2AmazonAsin ? 1 : 0);

  const apifyCost = 
    (2 * COSTS.apify_reddit_search) +
    (2 * COSTS.apify_reddit_scrape) +
    (2 * COSTS.apify_amazon_reviews) +
    (competitor1AmazonAsin ? COSTS.apify_amazon_reviews : 0) +
    (competitor2AmazonAsin ? COSTS.apify_amazon_reviews : 0);

  return {
    apifyCalls,
    apifyCost,
    assemblyAICalls: 0,
    assemblyAICost: 0,
    claudeCalls: 0,
    claudeCost: 0,
    totalCost: apifyCost,
    breakdown: [
      `${apifyCalls} Apify calls: $${apifyCost.toFixed(2)}`,
    ],
  };
}

export async function estimateAdTranscriptCost(projectId: string): Promise<CostEstimate> {
  const assetCount = await prisma.adAsset.count({
    where: {
      projectId,
      platform: 'TIKTOK',
      OR: [{ transcript: null }, { transcript: '' }],
    },
  });

  const avgDuration = 30;
  const assemblyAICost = assetCount * avgDuration * COSTS.assemblyai_transcript;

  return {
    apifyCalls: 0,
    apifyCost: 0,
    assemblyAICalls: assetCount,
    assemblyAICost,
    claudeCalls: 0,
    claudeCost: 0,
    totalCost: assemblyAICost,
    breakdown: [
      `${assetCount} transcripts × ${avgDuration}s: $${assemblyAICost.toFixed(2)}`,
    ],
  };
}

export async function estimatePatternAnalysisCost(projectId: string): Promise<CostEstimate> {
  const assetCount = await prisma.adAsset.count({
    where: { projectId, transcript: { not: null } },
  });

  const avgTokensPerAd = 500;
  const totalInputTokens = assetCount * avgTokensPerAd;
  const estimatedOutputTokens = 5000;

  const claudeCost = 
    (totalInputTokens * COSTS.claude_opus_input) +
    (estimatedOutputTokens * COSTS.claude_opus_output);

  return {
    apifyCalls: 0,
    apifyCost: 0,
    assemblyAICalls: 0,
    assemblyAICost: 0,
    claudeCalls: 1,
    claudeCost,
    totalCost: claudeCost,
    breakdown: [
      `${assetCount} ads → ${totalInputTokens} input tokens: $${(totalInputTokens * COSTS.claude_opus_input).toFixed(2)}`,
      `~${estimatedOutputTokens} output tokens: $${(estimatedOutputTokens * COSTS.claude_opus_output).toFixed(2)}`,
    ],
  };
}

const PROJECT_BUDGET_LIMITS: Record<string, number> = {
  default: 50.0,
};

export async function checkBudget(projectId: string, estimatedCost: number): Promise<boolean> {
  const limit = PROJECT_BUDGET_LIMITS[projectId] || PROJECT_BUDGET_LIMITS.default;
  return estimatedCost <= limit;
}
