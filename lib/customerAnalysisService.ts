// lib/customerAnalysisService.ts
import { cfg } from "@/lib/config";
import prisma from '@/lib/prisma';
import { JobType, ResearchSource } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';

type CustomerAvatarJSON = {
  problems?: {
    issue?: string;
    market_size?: "large" | "medium" | "small";
    pain_intensity?: "high" | "medium" | "low";
    specificity?: "high" | "medium" | "low";
    quotes?: string[];
    source?: "product_positive" | "product_reddit" | "competitor" | "market_reddit" | "uploaded";
  }[];
  failed_alternatives?: { product?: string; why_failed?: string; quote?: string; source?: "product_positive" | "product_reddit" | "competitor" | "market_reddit" | "uploaded" }[];
  purchase_blockers?: { blocker?: string; type?: "price" | "trust" | "complexity" | "results" | "other"; quote?: string; source?: "product_positive" | "product_reddit" | "competitor" | "market_reddit" | "uploaded" }[];
  buy_triggers?: { trigger?: string; evidence_strength?: "strong" | "moderate" | "weak"; quote?: string; source?: "product_positive" | "product_reddit" | "competitor" | "market_reddit" | "uploaded" }[];
  demographics?: { signal?: string; quote?: string; source?: "product_positive" | "product_reddit" | "competitor" | "market_reddit" | "uploaded" }[];
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
  competitor3: string[];
  uploadedData: string[];
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
  const competitor3: string[] = [];
  const uploadedData: string[] = [];

  for (const row of rows) {
    switch (String(row.source)) {
      case 'REDDIT_PRODUCT':
        redditProduct.push(row.content);
        break;
      case 'REDDIT_PROBLEM':
        redditProblem.push(row.content);
        break;
      case 'UPLOADED':
        uploadedData.push(row.content);
        break;
      case 'AMAZON': {
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
        if (amazonKind === 'competitor_3') {
          competitor3.push(row.content);
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
    competitor3,
    uploadedData,
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
    competitor3,
    uploadedData,
  } = grouped;

  const prompt = `
Analyze customer data for ${productName}.
Problem solved: ${productProblemSolved}

YOUR PRODUCT - WINS (${amazon4.length + amazon5.length} reviews):
${[...amazon4, ...amazon5].join('\n---\n')}

YOUR PRODUCT - REDDIT (${redditProduct.length} discussions):
${redditProduct.join('\n---\n')}

COMPETITOR - FAILURES (${competitor1.length + competitor2.length + competitor3.length} reviews):
${[...competitor1, ...competitor2, ...competitor3].join('\n---\n')}

MARKET - FRUSTRATIONS (${redditProblem.length} discussions):
${redditProblem.join('\n---\n')}

UPLOADED - PROPRIETARY (${uploadedData.length} entries):
${uploadedData.join('\n---\n')}

Scoring:
- Reddit upvote score = market agreement size, Weigh higher but keep lower scores in mind
- Emotional language = pain intensity, Weighed higher than non emotional language
- Specific details (numbers, parts, timeframes) = actionability, Weighed higher than broad descriptions

Return JSON:
{
  "problems": [
    {
      "issue": "",
      "market_size": "large|medium|small",
      "pain_intensity": "high|medium|low",
      "specificity": "high|medium|low",
      "quotes": [""],
      "source": "product_positive|product_reddit|competitor|market_reddit|uploaded"
    }
  ],
  "failed_alternatives": [
    {
      "product": "",
      "why_failed": "",
      "quote": "",
      "source": "product_positive|product_reddit|competitor|market_reddit|uploaded"
    }
  ],
  "purchase_blockers": [
    {
      "blocker": "",
      "type": "price|trust|complexity|results|other",
      "quote": "",
      "source": "product_positive|product_reddit|competitor|market_reddit|uploaded"
    }
  ],
  "buy_triggers": [
    {
      "trigger": "",
      "evidence_strength": "strong|moderate|weak",
      "quote": "",
      "source": "product_positive|product_reddit|competitor|market_reddit|uploaded"
    }
  ],
  "demographics": [
    {
      "signal": "",
      "quote": "",
      "source": "product_positive|product_reddit|competitor|market_reddit|uploaded"
    }
  ]
}

Rules:
- Extract only explicit statements
- market_size = frequency + reddit upvotes
- pain_intensity = emotional language strength
- specificity = numbers/parts/cause-effect present
- Source attribution required
- Empty array if <3 supporting quotes
`;

  const system = 'Return ONLY valid JSON. Start with {. End with }. No markdown. No text.';

  return { system, prompt };
}

/**
 * Generic helper to call Anthropic Claude with retries.
 */
async function callAnthropic(system: string, prompt: string): Promise<string> {
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
  const apiKey = env('ANTHROPIC_API_KEY')!;
  const model = cfg.raw("ANTHROPIC_MODEL") ?? 'claude-opus-4-5-20251101';

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
  const avatars = await prisma.customerAvatar.findMany({ where: { projectId }, select: { id: true, persona: true } });
  const now = new Date();
  for (const a of avatars) {
    const persona = (a.persona as any) || {};
    if (!persona?.archivedAt) {
      await prisma.customerAvatar.update({ where: { id: a.id }, data: { persona: { ...persona, archivedAt: now } as any } });
    }
  }
}

async function purgeExpiredCustomerAvatars(projectId: string) {
  if (!CUSTOMER_ANALYSIS_RETENTION_DAYS || CUSTOMER_ANALYSIS_RETENTION_DAYS <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const avatars = await prisma.customerAvatar.findMany({ where: { projectId }, select: { id: true, persona: true } });
  const toDeleteAvatarIds = avatars.filter(a => {
    const archived = (a.persona as any)?.archivedAt;
    return archived ? new Date(archived) < cutoff : false;
  }).map(a => a.id);
  if (toDeleteAvatarIds.length) {
    await prisma.customerAvatar.deleteMany({ where: { id: { in: toDeleteAvatarIds } } });
  }
}

/**
 * Main entry point for Phase 1B – Customer Analysis.
 */
export async function runCustomerAnalysis(args: {
  projectId: string;
  productName?: string;
  productProblemSolved?: string;
  jobId?: string;
  runId?: string;
}) {
  const { projectId, jobId, runId } = args;
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');

  if (!runId) {
    throw new Error('Customer analysis requires runId in job payload.');
  }

  const { productName, productProblemSolved } = await resolveProductContext(projectId, args.productName, args.productProblemSolved);

  if (!productName || !productProblemSolved) {
    throw new Error('Product name and solved problem are required. Provide them or run Phase 1A to capture offering details.');
  }

  const researchRowsRaw = await prisma.researchRow.findMany({
    where: { projectId, job: { runId } },
    select: {
      source: true,
      content: true,
      metadata: true,
    },
  });

  const uploadedData = researchRowsRaw
    .filter((row) => row.source === 'UPLOADED')
    .map((row) => row.content ?? '')
    .filter((content) => content.trim().length > 0);

  const researchRows = researchRowsRaw.map(r => ({
    source: r.source as any,
    content: r.content ?? '',
    rating: (r.metadata as any)?.rating ?? null,
    metadata: r.metadata,
  }));

  if (researchRows.length < CUSTOMER_ANALYSIS_MIN_ROWS) {
    throw new Error(
      `Customer analysis requires at least ${CUSTOMER_ANALYSIS_MIN_ROWS} research rows. Found ${researchRows.length}. Run/expand Phase 1A first.`,
    );
  }

  const grouped = {
    ...groupResearchRows(researchRows, productName, productProblemSolved),
    uploadedData,
  };

  const avatarPrompt = buildCustomerAvatarPrompt(grouped);
  const avatarText = await callAnthropic(avatarPrompt.system, avatarPrompt.prompt);
  const avatarJson = ensureObject<CustomerAvatarJSON>(parseJsonFromLLM(avatarText), 'Avatar');

  await archiveExistingAvatars(projectId);
  const avatarRecord = await prisma.customerAvatar.create({
    data: {
      projectId,
      persona: avatarJson as any,
    },
  });

  await purgeExpiredCustomerAvatars(projectId);

  const personaObj = (avatarRecord.persona as any) || {};
  const problems = Array.isArray(personaObj?.problems) ? personaObj.problems : [];
  const buyTriggers = Array.isArray(personaObj?.buy_triggers) ? personaObj.buy_triggers : [];
  const avatarSummary = {
    primaryPain: problems[0]?.issue ?? null,
    primaryGoal: buyTriggers[0]?.trigger ?? null,
  };

  return {
    avatarId: avatarRecord.id,
    researchRowCount: researchRows.length,
    productName,
    productProblemSolved,
    runId,
    summary: {
      avatar: avatarSummary,
    },
  };
}

export async function purgeCustomerProfileArchives(projectId: string) {
  await purgeExpiredCustomerAvatars(projectId);
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
