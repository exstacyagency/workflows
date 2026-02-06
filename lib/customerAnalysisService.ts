// lib/customerAnalysisService.ts
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import prisma from '@/lib/prisma';
import { JobType, ResearchSource } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';

type CustomerAvatarJSON = {
  avatar: {
    profile: {
      life_stage: string;
      awareness_level: "problem-aware" | "solution-aware" | "product-aware";
      decision_urgency: "immediate" | "researching" | "chronic";
    };
    primary_pain: {
      pain: string;
      supporting_quotes: string[];
    };
    primary_goal: {
      goal: string;
      supporting_quotes: string[];
    };
    failed_alternatives: Array<{
      product: string;
      why_failed: string;
      emotional_impact: string;
      supporting_quotes: string[];
    }>;
    buy_trigger: {
      trigger: string;
      supporting_quotes: string[];
    };
    main_objections: Array<{
      objection: string;
      supporting_quotes: string[];
    }>;
    success_criteria: {
      criteria: string;
      supporting_quotes: string[];
    };
    voc_phrases: string[];
    hook_angles: Array<{
      angle: string;
      based_on_pattern: string;
      evidence_quotes: string[];
    }>;
  };
};

const CUSTOMER_ANALYSIS_MIN_ROWS = Number(cfg.raw("CUSTOMER_ANALYSIS_MIN_ROWS") ?? 15);
const CUSTOMER_ANALYSIS_LLM_RETRIES = Math.max(
  1,
  Number(cfg.raw("CUSTOMER_ANALYSIS_LLM_RETRIES") ?? 3)
);
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
  const rawRedditProduct: Array<{ content: string; upvotes: number }> = [];
  const rawRedditProblem: Array<{ content: string; upvotes: number }> = [];
  const competitor1: string[] = [];
  const competitor2: string[] = [];
  const competitor3: string[] = [];
  const uploadedData: string[] = [];

  for (const row of rows) {
    switch (String(row.source)) {
      case 'REDDIT_PRODUCT':
        rawRedditProduct.push({
          content: row.content || "",
          upvotes: Number((row.metadata as any)?.score ?? 0),
        });
        break;
      case 'REDDIT_PROBLEM':
        rawRedditProblem.push({
          content: row.content || "",
          upvotes: Number((row.metadata as any)?.score ?? 0),
        });
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

  const redditProduct = rawRedditProduct
    .filter((p) => p.upvotes >= 10)
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, 50)
    .map((p) => `[UPVOTES: ${p.upvotes} | TYPE: PRODUCT]\n${p.content}`);

  const redditProblem = rawRedditProblem
    .filter((p) => p.upvotes >= 20)
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, 50)
    .map((p) => `[UPVOTES: ${p.upvotes} | TYPE: MARKET_FRUSTRATION]\n${p.content}`);

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
function buildCustomerAvatarPrompt(
  grouped: GroupedResearch,
  researchRowCount: number
): { system: string; prompt: string } {
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
MANDATORY FORMAT: Every major field MUST include "supporting_quotes": [] array with 2-5 direct verbatim quotes from the data. If you cannot find direct quotes, mark the field as [INSUFFICIENT DATA] instead of guessing.

Analyze ${researchRowCount} customer data points for ${productName} (solves: ${productProblemSolved}).

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

Create ONE customer avatar representing the most common buyer pattern.

CRITICAL: Every field must be backed by direct quotes. If you can't find 3+ quotes supporting a claim, don't include it.

Return JSON:
{
  "avatar": {
    "profile": {
      "life_stage": "specific situation with supporting_quotes: []",
      "awareness_level": "problem-aware|solution-aware|product-aware",
      "decision_urgency": "immediate|researching|chronic"
    },
    "primary_pain": {
      "pain": "the ONE pain that shows up most with highest emotional intensity",
      "supporting_quotes": ["direct quotes that prove this"]
    },
    "primary_goal": {
      "goal": "what they actually want beyond 'clear skin'",
      "supporting_quotes": ["direct quotes"]
    },
    "failed_alternatives": [
      {
        "product": "",
        "why_failed": "",
        "emotional_impact": "",
        "supporting_quotes": ["direct quotes showing failure and impact"]
      }
    ],
    "buy_trigger": {
      "trigger": "the specific moment/realization that causes purchase",
      "supporting_quotes": ["direct quotes showing this trigger"]
    },
    "main_objections": [
      {
        "objection": "",
        "supporting_quotes": ["direct quotes"]
      }
    ],
    "success_criteria": {
      "criteria": "what 'worked' means to them specifically",
      "supporting_quotes": ["direct quotes"]
    },
    "voc_phrases": ["exact customer language for ad copy - must appear verbatim in data"],
    "hook_angles": [
      {
        "angle": "",
        "based_on_pattern": "explain which quotes/patterns this angle exploits",
        "evidence_quotes": ["direct quotes that support this angle"]
      }
    ]
  }
}

SCORING WEIGHTS:
- Reddit upvotes = market size signal
- Emotional language intensity = pain level
- Specific details (timeframes, numbers) = higher value
- Frequency across sources = pattern strength

RULES:
- NO claims without quotes
- If VOC phrase isn't verbatim from data, exclude it
- Hook angles must reference specific customer language patterns
- Minimum 3 quotes per major claim or mark as [LOW CONFIDENCE]
`;

  const system = 'Return ONLY valid JSON. Start with {. End with }. No markdown. No text.';

  return { system, prompt };
}

/**
 * Generic helper to call Anthropic Claude with retries.
 */
async function callAnthropic(
  system: string,
  prompt: string,
  productName: string
): Promise<string> {
  try {
    console.log('[Customer Analysis] Checking for ANTHROPIC_API_KEY...');
    requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
    console.log('[Customer Analysis] ANTHROPIC_API_KEY found');
  } catch (error) {
    console.error('[Customer Analysis] ANTHROPIC_API_KEY missing!');
    throw error;
  }
  const apiKey = env('ANTHROPIC_API_KEY')!;
  const anthropic = new Anthropic({ apiKey });
  console.log('CUSTOMER_ANALYSIS_LLM_RETRIES:', CUSTOMER_ANALYSIS_LLM_RETRIES);
  console.log('API Key present:', !!apiKey);
  console.log('API Key length:', apiKey?.length);
  const model = "claude-sonnet-4-20250514";
  const maxTokens = 16000;
  const temperature = 1;

  console.log('[Customer Analysis] Calling Anthropic API...');
  console.log('[Customer Analysis] Prompt length:', prompt.length);
  console.log('[Customer Analysis] System length:', system.length);
  console.log('[Customer Analysis] Model:', model);
  console.log('[Customer Analysis] ANTHROPIC_API_KEY set:', Boolean(apiKey));
  console.log('[Customer Analysis] CUSTOMER_ANALYSIS_LLM_RETRIES:', CUSTOMER_ANALYSIS_LLM_RETRIES);
  console.log('[Customer Analysis] Starting retry loop, max attempts:', CUSTOMER_ANALYSIS_LLM_RETRIES);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= CUSTOMER_ANALYSIS_LLM_RETRIES; attempt++) {
    try {
      console.log('[Customer Analysis] Retry attempt:', attempt);
      const requestBody = {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: prompt }],
      };

      const body = JSON.stringify(requestBody);
      console.log('[Customer Analysis] JSON body created, length:', body.length);
      console.log('[Customer Analysis Worker] About to call Anthropic');
      console.log('[Customer Analysis Worker] Model:', model);
      console.log('[Customer Analysis Worker] Max tokens:', maxTokens);
      console.log('[Customer Analysis Worker] Prompt length:', prompt.length);

      const logDir = path.join(process.cwd(), "logs", "anthropic");
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
      const sanitizedProduct = (productName || "unknown")
        .replace(/[^a-zA-Z0-9]/g, "-")
        .substring(0, 30);
      const requestPath = path.join(logDir, `request-${sanitizedProduct}-${timestamp}.json`);
      const responsePath = path.join(logDir, `response-${sanitizedProduct}-${timestamp}.json`);

      writeFileSync(requestPath, JSON.stringify(requestBody, null, 2));
      console.log(`[ANTHROPIC] Request logged to ${requestPath}`);

      let response: Awaited<ReturnType<typeof anthropic.messages.create>>;
      try {
        response = await anthropic.messages.create(requestBody);
      } catch (error) {
        console.error("[Anthropic] Fetch failed:", error);
        throw error;
      }

      writeFileSync(responsePath, JSON.stringify(response, null, 2));
      console.log(`[ANTHROPIC] Response logged to ${responsePath}`);

      const content =
        (response as any)?.content?.[0]?.text ??
        (response as any)?.content ??
        "";
      if (!content) {
        throw new Error('Anthropic response missing content');
      }
      console.log('[Customer Analysis] API call succeeded');
      return content as string;
    } catch (error) {
      console.error('[Customer Analysis] Anthropic API Error:', error);
      const err = error as any;
      console.error('[Customer Analysis] Error details:', {
        message: err?.message,
        status: err?.status,
        type: err?.type,
        error: err?.error,
      });
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

  const avatarPrompt = buildCustomerAvatarPrompt(grouped, researchRows.length);
  const avatarText = await callAnthropic(
    avatarPrompt.system,
    avatarPrompt.prompt,
    productName
  );
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
  const avatar = (personaObj as any)?.avatar ?? {};
  const avatarSummary = {
    primaryPain: avatar?.primary_pain?.pain ?? null,
    primaryGoal: avatar?.primary_goal?.goal ?? null,
  };

  return {
    avatarId: avatarRecord.id,
    persona: avatarRecord.persona,
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
