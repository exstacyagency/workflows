// lib/productAnalysisService.ts
import { cfg } from "@/lib/config";
import { prisma } from './prisma';
import { logError } from './logger';
import { JobType, JobStatus } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';

interface ProductAnalysisParams {
  projectId: string;
  jobId: string;
  runId?: string;
}

type ProductIntelJSON = {
  ingredients?: { name: string; concentration: string; function: string; quote: string }[];
  mechanism?: { process: string; timeline: string; quote: string }[];
  formulation?: { form: string; properties: string; quote: string }[];
  dosage?: { amount: string; frequency: string; method: string; quote: string }[];
  timeline?: { stage: string; duration: string; quote: string }[];
  vs_competitors?: { competitor: string; mechanism_diff: string; quote: string }[];
  limitations?: { cannot_do: string; reason: string; quote: string }[];
  [key: string]: any;
};

const PRODUCT_ANALYSIS_LLM_RETRIES = Number(cfg.raw("PRODUCT_ANALYSIS_LLM_RETRIES") ?? 3);
const PRODUCT_ANALYSIS_LLM_BACKOFF_MS = Number(cfg.raw("PRODUCT_ANALYSIS_LLM_BACKOFF_MS") ?? 1500);
const PRODUCT_ANALYSIS_RETENTION_DAYS = Number(cfg.raw("PRODUCT_ANALYSIS_RETENTION_DAYS") ?? 90);
const PRODUCT_RETENTION_MS = PRODUCT_ANALYSIS_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildProductIntelPrompt(productName: string): { system: string; prompt: string } {
  const prompt = `Extract product mechanism for ${productName}.
ONLY extract: what product is, what it does, how it works.
NO customer emotions, pain points, or psychology. Pure product intelligence.

Use web search. Every source must be cited accurately. Only information about ${productName}.

1. ACTIVE INGREDIENTS
- Ingredient name
- Concentration (if stated)
- Function
Quote: "..."

2. MECHANISM
- Biological process
- Pathway
- Cellular action
- Timeline
Quote: "..."

3. FORMULATION
- Form (cream/serum/gel/powder/capsule)
- pH (if mentioned)
- Delivery system
Quote: "..."

4. DOSAGE PROTOCOL
- Amount
- Frequency
- Duration
- Method
Quote: "..."

5. RESULTS TIMELINE
- Initial: days/weeks
- Peak: weeks/months
- Maintenance: ongoing
Quote: "..."

6. COMPETITIVE MECHANISM
- Competitor name
- Mechanism difference
- Ingredient difference
Quote: "..."

7. LIMITATIONS
- Conditions ineffective for
- Contraindications
Quote: "..."

Return valid JSON with this EXACT structure:
{
  "ingredients": [{"name": "", "concentration": "", "function": "", "quote": ""}],
  "mechanism": [{"process": "", "timeline": "", "quote": ""}],
  "formulation": [{"form": "", "properties": "", "quote": ""}],
  "dosage": [{"amount": "", "frequency": "", "method": "", "quote": ""}],
  "timeline": [{"stage": "initial|peak|maintenance", "duration": "", "quote": ""}],
  "vs_competitors": [{"competitor": "", "mechanism_diff": "", "quote": ""}],
  "limitations": [{"cannot_do": "", "reason": "", "quote": ""}]
}`;

  const system =
    'You are a product research analyst. Return ONLY valid JSON. No markdown fences, no preamble, no explanation. Pure JSON object.';

  return { system, prompt };
}

async function callAnthropic(system: string, prompt: string): Promise<string> {
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
  const apiKey = env('ANTHROPIC_API_KEY')!;
  const model = cfg.raw('ANTHROPIC_MODEL') || 'claude-sonnet-4-5-20250929';

  const body = JSON.stringify({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= PRODUCT_ANALYSIS_LLM_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic request failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      const content = data?.content?.[0]?.text ?? data?.content ?? '';
      if (!content) {
        throw new Error('Anthropic response missing content');
      }
      return content as string;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === PRODUCT_ANALYSIS_LLM_RETRIES) {
        break;
      }
      const backoff = Math.min(PRODUCT_ANALYSIS_LLM_BACKOFF_MS * attempt, 10000);
      await sleep(backoff);
    }
  }

  throw lastError ?? new Error('Anthropic request failed');
}

function parseJsonFromLLM(text: string): any {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1] : text;

  const start = raw.indexOf('{');
  if (start === -1) {
    throw new Error('No "{" found in LLM response');
  }

  let braceCount = 0;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') braceCount++;
    if (raw[i] === '}') braceCount--;
    if (braceCount === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new Error('Unclosed JSON object in LLM response');
  }

  const jsonStr = raw.substring(start, end + 1).trim();
  return JSON.parse(jsonStr);
}

function ensureObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} JSON was not an object`);
  }
  return value as T;
}

async function archiveExistingProductIntel(projectId: string) {
  const items = await prisma.productIntelligence.findMany({ where: { projectId }, select: { id: true, insights: true } });
  const now = new Date();
  for (const it of items) {
    const insights = (it.insights as any) || {};
    if (!insights?.archivedAt) {
      await prisma.productIntelligence.update({ where: { id: it.id }, data: { insights: { ...insights, archivedAt: now } as any } });
    }
  }
}

async function purgeExpiredProductIntel(projectId: string) {
  if (!PRODUCT_ANALYSIS_RETENTION_DAYS || PRODUCT_ANALYSIS_RETENTION_DAYS <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - PRODUCT_RETENTION_MS);
  const products = await prisma.productIntelligence.findMany({ where: { projectId }, select: { id: true, insights: true } });
  const toDeleteProductIds = products.filter(p => {
    const archived = (p.insights as any)?.archivedAt;
    return archived ? new Date(archived) < cutoff : false;
  }).map(p => p.id);
  if (toDeleteProductIds.length) {
    await prisma.productIntelligence.deleteMany({ where: { id: { in: toDeleteProductIds } } });
  }
}

async function resolveProductName(projectId: string, runId?: string) {
  const job = await prisma.job.findFirst({
    where: {
      projectId,
      ...(runId ? { runId } : {}),
      type: JobType.PRODUCT_DATA_COLLECTION,
      status: JobStatus.COMPLETED,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true },
  });

  const payload = (job?.payload ?? {}) as Record<string, any>;
  const payloadName = typeof payload.productName === 'string' ? payload.productName.trim() : '';

  if (payloadName) {
    return { productName: payloadName, productDataCollectionJobId: job?.id ?? null };
  }

  const productIntelligence = await prisma.productIntelligence.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  const insights = (productIntelligence?.insights ?? {}) as Record<string, any>;
  const insightName = typeof insights.productName === 'string' ? insights.productName.trim() : '';

  return { productName: insightName, productDataCollectionJobId: job?.id ?? null };
}

export async function analyzeProductData(params: ProductAnalysisParams) {
  const { projectId, jobId, runId } = params;

  try {
    console.log(`[ProductAnalysis] Starting for job ${jobId}`);

    requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');

    const { productName, productDataCollectionJobId } = await resolveProductName(projectId, runId);
    if (!productName) {
      throw new Error('Product name not found. Run product data collection first.');
    }

    const productPrompt = buildProductIntelPrompt(productName);
    const productText = await callAnthropic(productPrompt.system, productPrompt.prompt);
    const productJson = ensureObject<ProductIntelJSON>(parseJsonFromLLM(productText), 'Product intelligence');

    await archiveExistingProductIntel(projectId);
    const productRecord = await prisma.productIntelligence.create({
      data: {
        projectId,
        insights: productJson as any,
      },
    });

    await purgeExpiredProductIntel(projectId);

    const insightsObj = (productRecord.insights as any) || {};
    const productSummary = {
      heroIngredient: insightsObj?.ingredients?.[0]?.name ?? null,
      heroMechanism: insightsObj?.mechanism?.[0]?.process ?? null,
      form: insightsObj?.formulation?.[0]?.form ?? null,
      initialTimeline: insightsObj?.timeline?.find((t: any) => String(t.stage ?? '').toLowerCase().includes('initial'))?.duration ?? null,
      peakTimeline: insightsObj?.timeline?.find((t: any) => String(t.stage ?? '').toLowerCase().includes('peak'))?.duration ?? null,
    };

    console.log(`[ProductAnalysis] Completed for job ${jobId}`);

    return {
      ok: true,
      productIntelligenceId: productRecord.id,
      productDataCollectionJobId,
      productName,
      summary: {
        product: productSummary,
      },
    };
  } catch (error: any) {
    logError('productAnalysis.failed', error, { jobId, projectId });
    throw error;
  }
}
