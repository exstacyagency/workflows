// lib/customerAnalysisService.ts
import { cfg } from "@/lib/config";
import prisma from '@/lib/prisma';
import { JobType, ResearchSource } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';

type CustomerAvatarJSON = {
  avatar_snapshot?: {
    age?: number;
    gender?: string;
    income?: number;
    job?: string;
    location?: string;
    ethnicity?: string;
  };
  top_pains?: { pain?: string; quotes?: string[]; visual?: string }[];
  goals?: { now?: string[]; future?: string[] };
  [key: string]: any;
};

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

const CUSTOMER_ANALYSIS_MIN_ROWS = Number(cfg.raw("CUSTOMER_ANALYSIS_MIN_ROWS") ?? 15);
const CUSTOMER_ANALYSIS_LLM_RETRIES = Number(cfg.raw("CUSTOMER_ANALYSIS_LLM_RETRIES") ?? 3);
const CUSTOMER_ANALYSIS_LLM_BACKOFF_MS = Number(cfg.raw("CUSTOMER_ANALYSIS_LLM_BACKOFF_MS") ?? 1500);
const CUSTOMER_ANALYSIS_RETENTION_DAYS = Number(cfg.raw("CUSTOMER_ANALYSIS_RETENTION_DAYS") ?? 90);
const RETENTION_MS = CUSTOMER_ANALYSIS_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type GroupedResearch = {
  productName: string;
  productProblemSolved: string;
  amazon5: string[];
  amazon4: string[];
  redditProduct: string[];
  redditProblem: string[];
  competitor1: string[];
  competitor2: string[];
};

type ResearchRowForGrouping = {
  source: ResearchSource;
  content: string;
  rating?: number | null;
  metadata?: any;
};

function groupResearchRows(
  rows: ResearchRowForGrouping[],
  productName: string,
  productProblemSolved: string
): GroupedResearch {
  const amazon5: string[] = [];
  const amazon4: string[] = [];
  const redditProduct: string[] = [];
  const redditProblem: string[] = [];
  const competitor1: string[] = [];
  const competitor2: string[] = [];

  for (const row of rows) {
    switch (row.source) {
      case ResearchSource.REDDIT_PRODUCT:
        redditProduct.push(row.content);
        break;
      case ResearchSource.REDDIT_PROBLEM:
        redditProblem.push(row.content);
        break;
      case ResearchSource.AMAZON: {
        const meta = (row.metadata ?? {}) as any;
        const amazonKind = typeof meta?.amazonKind === 'string' ? meta.amazonKind : null;

        if (amazonKind === 'product_5_star') {
          amazon5.push(row.content);
          break;
        }
        if (amazonKind === 'product_4_star') {
          amazon4.push(row.content);
          break;
        }
        if (amazonKind === 'competitor_1') {
          competitor1.push(row.content);
          break;
        }
        if (amazonKind === 'competitor_2') {
          competitor2.push(row.content);
          break;
        }

        const rating = typeof row.rating === 'number' ? row.rating : Number(row.rating);
        if (!Number.isNaN(rating) && rating >= 5) {
          amazon5.push(row.content);
        } else if (!Number.isNaN(rating) && rating >= 4) {
          amazon4.push(row.content);
        }
        break;
      }
    }
  }

  return {
    productName,
    productProblemSolved,
    amazon5,
    amazon4,
    redditProduct,
    redditProblem,
    competitor1,
    competitor2,
  };
}

/**
 * Build Customer Avatar prompt from grouped research (mirrors your n8n Customer Avatar Prompt).
 */
function buildCustomerAvatarPrompt(grouped: GroupedResearch): { system: string; prompt: string } {
  const {
    productName,
    productProblemSolved,
    amazon5,
    amazon4,
    redditProduct,
    redditProblem,
    competitor1,
    competitor2,
  } = grouped;

  const competitorAll = [...competitor1, ...competitor2];

  const prompt = `Extract customer avatar for ${productName}.

PRODUCT: ${productName}
PROBLEM: ${productProblemSolved}

5-STAR REVIEWS (${amazon5.length}):
${amazon5.join('\n---\n')}

4-STAR REVIEWS (${amazon4.length}):
${amazon4.join('\n---\n')}

REDDIT PROBLEM (${redditProblem.length}):
${redditProblem.join('\n---\n')}

REDDIT PRODUCT (${redditProduct.length}):
${redditProduct.join('\n---\n')}

COMPETITOR 1-STAR (${competitorAll.length}):
${competitorAll.join('\n---\n')}

Use web search for missing data. Only ${productName}. Cite sources.

Return this exact JSON:
{
  "avatar_snapshot": {"age": 0, "gender": "", "income": 0, "job": "", "location": "", "ethnicity": ""},
  "physical_manifestations": {"when_frustrated": "", "body_language": "", "facial_tells": "", "daily_setting": "", "routine_timing": ""},
  "top_pains": [{"pain": "", "quotes": [], "visual": ""}],
  "failed_solutions": [{"solution": "", "why_failed": "", "quote": "", "visual_evidence": ""}],
  "purchase_blockers": [{"fear": "", "quote": "", "physical_tell": ""}],
  "buy_triggers": [],
  "goals": {"now": [], "future": []},
  "psychographics": {"values": "", "decision_pattern": "", "belief": ""},
  "emotional_journey": {"before": "", "problem_hits": "", "failed_solutions": "", "breaking_point": "", "after_solution": ""},
  "visual_environment": {"bathroom": "", "lighting": "", "mirror_time": "", "application_setting": ""}
}`;

  const system = 'Return ONLY valid JSON. Start with {. End with }. No markdown. No text.';

  return { system, prompt };
}

/**
 * Build Product Intelligence prompt from product name (mirrors your n8n Product Intelligence Prompt).
 */
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

/**
 * Generic helper to call Anthropic Claude with retries.
 */
async function callAnthropic(system: string, prompt: string): Promise<string> {
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
  const apiKey = env('ANTHROPIC_API_KEY')!;
  const model = cfg.raw("ANTHROPIC_MODEL") ?? 'claude-3-opus-20240229';

  const body = JSON.stringify({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= CUSTOMER_ANALYSIS_LLM_RETRIES; attempt++) {
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
      if (attempt === CUSTOMER_ANALYSIS_LLM_RETRIES) {
        break;
      }
      const backoff = Math.min(CUSTOMER_ANALYSIS_LLM_BACKOFF_MS * attempt, 10000);
      await sleep(backoff);
    }
  }

  throw lastError ?? new Error('Anthropic request failed');
}

/**
 * Extract the first JSON object from an LLM string response.
 */
function parseJsonFromLLM(text: string): any {
  // Try code fences first
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

async function archiveExistingAvatars(projectId: string) {
  await prisma.customerAvatar.updateMany({
    where: { projectId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

async function archiveExistingProductIntel(projectId: string) {
  await prisma.productIntelligence.updateMany({
    where: { projectId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

async function purgeExpiredSnapshots(projectId: string) {
  if (!CUSTOMER_ANALYSIS_RETENTION_DAYS || CUSTOMER_ANALYSIS_RETENTION_DAYS <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - RETENTION_MS);
  await prisma.customerAvatar.deleteMany({
    where: {
      projectId,
      archivedAt: {
        lt: cutoff,
      },
    },
  });
  await prisma.productIntelligence.deleteMany({
    where: {
      projectId,
      archivedAt: {
        lt: cutoff,
      },
    },
  });
}

/**
 * Main entry point for Phase 1B – Customer Analysis.
 */
export async function runCustomerAnalysis(args: {
  projectId: string;
  productName?: string;
  productProblemSolved?: string;
  jobId?: string;
}) {
  const { projectId, jobId } = args;
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');

  const { productName, productProblemSolved } = await resolveProductContext(projectId, args.productName, args.productProblemSolved);

  if (!productName || !productProblemSolved) {
    throw new Error('Product name and solved problem are required. Provide them or run Phase 1A to capture offering details.');
  }

  const researchRows = await prisma.researchRow.findMany({
    where: { projectId },
    select: {
      source: true,
      content: true,
      rating: true,
      metadata: true,
    },
  });

  if (researchRows.length < CUSTOMER_ANALYSIS_MIN_ROWS) {
    throw new Error(
      `Customer analysis requires at least ${CUSTOMER_ANALYSIS_MIN_ROWS} research rows. Found ${researchRows.length}. Run/expand Phase 1A first.`,
    );
  }

  const grouped = groupResearchRows(researchRows, productName, productProblemSolved);

  const avatarPrompt = buildCustomerAvatarPrompt(grouped);
  const productPrompt = buildProductIntelPrompt(productName);

  const avatarText = await callAnthropic(avatarPrompt.system, avatarPrompt.prompt);
  const avatarJson = ensureObject<CustomerAvatarJSON>(parseJsonFromLLM(avatarText), 'Avatar');

  const productText = await callAnthropic(productPrompt.system, productPrompt.prompt);
  const productJson = ensureObject<ProductIntelJSON>(parseJsonFromLLM(productText), 'Product intelligence');

  const avatarSnapshot = avatarJson.avatar_snapshot ?? {};
  const topPains = Array.isArray(avatarJson.top_pains) ? avatarJson.top_pains : [];
  const goalsNow = Array.isArray(avatarJson.goals?.now) ? avatarJson.goals?.now : [];

  await archiveExistingAvatars(projectId);
  const avatarRecord = await prisma.customerAvatar.create({
    data: {
      projectId,
      jobId,
      rawJson: avatarJson as any,
      age: typeof avatarSnapshot.age === 'number' ? avatarSnapshot.age : null,
      gender: typeof avatarSnapshot.gender === 'string' ? avatarSnapshot.gender : null,
      income: typeof avatarSnapshot.income === 'number' ? avatarSnapshot.income : null,
      jobTitle: typeof avatarSnapshot.job === 'string' ? avatarSnapshot.job : null,
      location: typeof avatarSnapshot.location === 'string' ? avatarSnapshot.location : null,
      ethnicity: typeof avatarSnapshot.ethnicity === 'string' ? avatarSnapshot.ethnicity : null,
      primaryPain: typeof topPains[0]?.pain === 'string' ? topPains[0]?.pain : null,
      primaryGoal: typeof goalsNow[0] === 'string' ? goalsNow[0] : null,
    },
  });

  const heroIngredient = productJson.ingredients?.[0]?.name ?? null;
  const heroMechanism = productJson.mechanism?.[0]?.process ?? null;
  const form = productJson.formulation?.[0]?.form ?? null;

  const initialStage = productJson.timeline?.find(t => t.stage?.toLowerCase().includes('initial'));
  const peakStage = productJson.timeline?.find(t => t.stage?.toLowerCase().includes('peak'));

  await archiveExistingProductIntel(projectId);
  const productRecord = await prisma.productIntelligence.create({
    data: {
      projectId,
      jobId,
      rawJson: productJson as any,
      heroIngredient: heroIngredient ?? null,
      heroMechanism: heroMechanism ?? null,
      form: form ?? null,
      initialTimeline: initialStage?.duration ?? null,
      peakTimeline: peakStage?.duration ?? null,
    },
  });

  await purgeExpiredSnapshots(projectId);

  const avatarSummary = {
    age: avatarRecord.age,
    gender: avatarRecord.gender,
    jobTitle: avatarRecord.jobTitle,
    location: avatarRecord.location,
    primaryPain: avatarRecord.primaryPain,
    primaryGoal: avatarRecord.primaryGoal,
  };

  const productSummary = {
    heroIngredient: productRecord.heroIngredient,
    heroMechanism: productRecord.heroMechanism,
    form: productRecord.form,
    initialTimeline: productRecord.initialTimeline,
    peakTimeline: productRecord.peakTimeline,
  };

  return {
    avatarId: avatarRecord.id,
    productIntelligenceId: productRecord.id,
    researchRowCount: researchRows.length,
    productName,
    productProblemSolved,
    summary: {
      avatar: avatarSummary,
      product: productSummary,
    },
  };
}

export async function purgeCustomerProfileArchives(projectId: string) {
  await purgeExpiredSnapshots(projectId);
}
async function resolveProductContext(projectId: string, productName?: string, productProblemSolved?: string) {
  let resolvedName = productName?.trim() ?? '';
  let resolvedProblem = productProblemSolved?.trim() ?? '';

  if (resolvedName && resolvedProblem) {
    return { productName: resolvedName, productProblemSolved: resolvedProblem };
  }

  const latestResearchJob = await prisma.job.findFirst({
    where: { projectId, type: JobType.CUSTOMER_RESEARCH },
    orderBy: { createdAt: 'desc' },
  });

  const payload = (latestResearchJob?.payload ?? {}) as Record<string, any>;
  resolvedName = resolvedName || payload?.offeringName || payload?.productName || '';
  resolvedProblem = resolvedProblem || payload?.valueProp || payload?.productProblemSolved || '';

  return { productName: resolvedName, productProblemSolved: resolvedProblem };
}
