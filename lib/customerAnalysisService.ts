// lib/customerAnalysisService.ts
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import prisma from '@/lib/prisma';
import { JobType } from '@prisma/client';
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

type CustomerAnalysisJSON = CustomerAvatarJSON & {
  competitive_analysis?: {
    main_product_pain_points?: Array<{
      pain: string;
      supporting_quotes: string[];
    }>;
    competitor_weaknesses?: Array<{
      competitor: "COMPETITOR_1" | "COMPETITOR_2" | "COMPETITOR_3";
      weaknesses: string[];
      supporting_quotes: string[];
    }>;
    competitive_gaps?: Array<{
      gap: string;
      supporting_quotes: string[];
    }>;
    market_opportunities?: Array<{
      opportunity: string;
      supporting_quotes: string[];
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
  productProblemSolved: string;
  mainProductReviews: string[];
  competitor1Reviews: string[];
  competitor2Reviews: string[];
  competitor3Reviews: string[];
  redditProduct: string[];
  redditProblem: string[];
  uploadedData: string[];
};

type AnalysisOperatorContext = {
  solutionKeywords: string[];
  additionalProblems: string[];
};

type ResearchRowForGrouping = {
  source: string;
  content: string;
  rating?: number | null;
  metadata?: any;
};

function groupResearchRows(
  rows: ResearchRowForGrouping[],
  productProblemSolved: string
): GroupedResearch {
  const mainProductReviews: string[] = [];
  const competitor1Reviews: string[] = [];
  const competitor2Reviews: string[] = [];
  const competitor3Reviews: string[] = [];
  const rawRedditProduct: Array<{ content: string; upvotes: number }> = [];
  const rawRedditProblem: Array<{ content: string; upvotes: number }> = [];
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
      case 'AMAZON_MAIN_PRODUCT':
        mainProductReviews.push(row.content || "");
        break;
      case 'AMAZON_COMPETITOR_1':
        competitor1Reviews.push(row.content || "");
        break;
      case 'AMAZON_COMPETITOR_2':
        competitor2Reviews.push(row.content || "");
        break;
      case 'AMAZON_COMPETITOR_3':
        competitor3Reviews.push(row.content || "");
        break;
      case 'AMAZON': {
        const meta = (row.metadata ?? {}) as any;
        const productType = String(meta?.productType || '').toUpperCase();
        const amazonKind = typeof meta?.amazonKind === 'string' ? meta.amazonKind : null;
        const content = row.content || '';

        if (productType === 'MAIN_PRODUCT') {
          mainProductReviews.push(content);
          break;
        }
        if (productType === 'COMPETITOR_1') {
          competitor1Reviews.push(content);
          break;
        }
        if (productType === 'COMPETITOR_2') {
          competitor2Reviews.push(content);
          break;
        }
        if (productType === 'COMPETITOR_3') {
          competitor3Reviews.push(content);
          break;
        }

        if (amazonKind === 'product_5_star') {
          mainProductReviews.push(content);
          break;
        }
        if (amazonKind === 'product_4_star') {
          mainProductReviews.push(content);
          break;
        }
        if (amazonKind === 'competitor_1') {
          competitor1Reviews.push(content);
          break;
        }
        if (amazonKind === 'competitor_2') {
          competitor2Reviews.push(content);
          break;
        }
        if (amazonKind === 'competitor_3') {
          competitor3Reviews.push(content);
          break;
        }

        const rating = typeof row.rating === 'number' ? row.rating : Number(row.rating);
        if (!Number.isNaN(rating)) {
          mainProductReviews.push(content);
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
    productProblemSolved,
    mainProductReviews,
    competitor1Reviews,
    competitor2Reviews,
    competitor3Reviews,
    redditProduct,
    redditProblem,
    uploadedData,
  };
}

/**
 * Build Customer Avatar prompt from grouped research (mirrors your n8n Customer Avatar Prompt).
 */
function buildCustomerAvatarPrompt(
  grouped: GroupedResearch,
  researchRowCount: number,
  operatorContext: AnalysisOperatorContext
): { system: string; prompt: string } {
  const {
    productProblemSolved,
    mainProductReviews,
    competitor1Reviews,
    competitor2Reviews,
    competitor3Reviews,
    redditProduct,
    redditProblem,
    uploadedData,
  } = grouped;
  const { solutionKeywords, additionalProblems } = operatorContext;
  const solutionKeywordLines =
    solutionKeywords.length > 0 ? solutionKeywords.map((value) => `- ${value}`).join('\n') : '(none provided)';
  const additionalProblemLines =
    additionalProblems.length > 0 ? additionalProblems.map((value) => `- ${value}`).join('\n') : '(none provided)';
  const totalCompetitorReviews =
    competitor1Reviews.length + competitor2Reviews.length + competitor3Reviews.length;

  const prompt = `
MANDATORY FORMAT: Every major field MUST include "supporting_quotes": [] array with 2-5 direct verbatim quotes from the data. If you cannot find direct quotes, mark the field as [INSUFFICIENT DATA] instead of guessing.

Analyze ${researchRowCount} customer data points for the problem: ${productProblemSolved}.

ALTERNATIVE SOLUTIONS - REDDIT (${solutionKeywords.length}):
${solutionKeywordLines}

MARKET FRUSTRATIONS - REDDIT (${redditProblem.length} discussions):
${redditProblem.join('\n---\n')}

ADDITIONAL PROBLEMS - REDDIT (${additionalProblems.length}):
${additionalProblemLines}

ALTERNATIVES - REDDIT (${redditProduct.length} discussions):
${redditProduct.join('\n---\n')}

COMPETITOR PRODUCT FAILURES - AMAZON REVIEWS (${totalCompetitorReviews} reviews):
These are competitor product reviews and should be treated as failure/pain evidence for positioning.
Competitor sources are intentionally low-star (1-3 stars) to surface what does NOT work.

COMPETITOR 1 REVIEWS (source = AMAZON_COMPETITOR_1) (low-star failures) (${competitor1Reviews.length} reviews):
${competitor1Reviews.join('\n---\n')}

COMPETITOR 2 REVIEWS (source = AMAZON_COMPETITOR_2) (low-star failures) (${competitor2Reviews.length} reviews):
${competitor2Reviews.join('\n---\n')}

COMPETITOR 3 REVIEWS (source = AMAZON_COMPETITOR_3) (low-star failures) (${competitor3Reviews.length} reviews):
${competitor3Reviews.join('\n---\n')}

MAIN PRODUCT SUCCESS - AMAZON REVIEWS (${mainProductReviews.length} reviews):
These are main-product high-star (4-5 stars) success signals showing what works for buyers.

MAIN PRODUCT REVIEWS (source = AMAZON_MAIN_PRODUCT) (high-star successes):
${mainProductReviews.join('\n---\n')}

UPLOADED - PROPRIETARY (${uploadedData.length} entries):
${uploadedData.join('\n---\n')}

Create ONE customer avatar representing the most common buyer pattern.

ALSO perform competitive analysis using the source segments above:
- Use COMPETITOR blocks as failure data (what breaks, disappoints, or causes churn).
- Use MAIN PRODUCT block as success data (what delivers outcomes and trust).
- COMPETITOR REVIEWS are low-star ratings showing product failures. Do NOT list positive attributes.
- Extract failures, complaints, and reasons for low ratings from competitor reviews.
- Focus on specific failure modes: ineffectiveness, side effects, quality issues, compliance/usability problems.
- MAIN PRODUCT REVIEWS are high-star ratings showing what works. Use these to contrast against competitor failures.
- Main product pain points and complaints
- What fails in each competitor and why customers rate them poorly
- Competitive gaps: what is missing from the main product that competitors have
- Opportunities: problems all products fail to solve

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
  },
  "competitive_analysis": {
    "main_product_pain_points": [
      {
        "pain": "",
        "supporting_quotes": ["direct quotes from source=AMAZON_MAIN_PRODUCT"]
      }
    ],
    "competitor_weaknesses": [
      {
        "competitor": "COMPETITOR_1|COMPETITOR_2|COMPETITOR_3",
        "weaknesses": ["specific failures from low-star competitor reviews"],
        "supporting_quotes": ["direct quotes from competitor sources"]
      }
    ],
    "competitive_gaps": [
      {
        "gap": "what competitor users get that main-product users say is missing",
        "supporting_quotes": ["direct quote evidence"]
      }
    ],
    "market_opportunities": [
      {
        "opportunity": "problem space all products fail to solve",
        "supporting_quotes": ["direct quote evidence"]
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
- Treat operator-provided solution keywords and additional problems as prioritization hints only
- If a provided keyword/problem is unsupported by quotes, mark it [LOW CONFIDENCE]
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
  prompt: string
): Promise<{
  content: string;
  requestPath: string;
  responsePath: string;
}> {
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
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
      const requestBody = {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
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
      const sanitizedTopic = "customer-analysis"
        .replace(/[^a-zA-Z0-9]/g, "-")
        .substring(0, 30);
      const requestPath = path.join(logDir, `request-${sanitizedTopic}-${timestamp}.json`);
      const responsePath = path.join(logDir, `response-${sanitizedTopic}-${timestamp}.json`);

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
      return {
        content: content as string,
        requestPath,
        responsePath,
      };
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
  productProblemSolved?: string;
  solutionKeywords?: string[];
  additionalProblems?: string[];
  jobId?: string;
  runId?: string;
}) {
  const { projectId, jobId, runId } = args;
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');

  if (!runId) {
    throw new Error('Customer analysis requires runId in job payload.');
  }

  const { productProblemSolved } = await resolveProblemContext(projectId, args.productProblemSolved);

  if (!productProblemSolved) {
    throw new Error('Problem to Research is required. Provide it or run customer collection first.');
  }

  console.log('[Analysis Debug] Querying research data...');
  const [mainProductReviews, competitorReviews] = await Promise.all([
    prisma.researchRow.findMany({
      where: {
        projectId,
        source: { in: ['AMAZON_MAIN_PRODUCT'] as any },
      },
      select: { content: true },
    }),
    prisma.researchRow.findMany({
      where: {
        projectId,
        source: {
          in: ['AMAZON_COMPETITOR_1', 'AMAZON_COMPETITOR_2', 'AMAZON_COMPETITOR_3'] as any,
        },
      },
      select: { content: true },
    }),
  ]);
  console.log('[Analysis Debug] Main product reviews:', mainProductReviews.length);
  console.log('[Analysis Debug] Competitor reviews:', competitorReviews.length);
  console.log(
    '[Analysis Debug] Sample main review:',
    mainProductReviews[0]?.content?.substring(0, 100),
  );
  console.log(
    '[Analysis Debug] Sample competitor review:',
    competitorReviews[0]?.content?.substring(0, 100),
  );

  const baseWhere = { projectId, job: { runId } };
  const runResearchJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.CUSTOMER_RESEARCH,
      runId,
    },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  const runPayload = (runResearchJob?.payload ?? {}) as Record<string, unknown>;
  const competitor1Asin = String(runPayload.competitor1Asin ?? '').trim();
  const competitor2Asin = String(runPayload.competitor2Asin ?? '').trim();
  const competitor3Asin = String(runPayload.competitor3Asin ?? '').trim();

  const researchRowSelect = {
    source: true,
    content: true,
    metadata: true,
  } as const;

  const [
    mainProductReviewsRaw,
    competitorReviewsBySource,
    legacyAmazonReviewsRaw,
    contextRowsRaw,
  ] = await Promise.all([
    prisma.researchRow.findMany({
      where: {
        ...baseWhere,
        source: "AMAZON_MAIN_PRODUCT" as any,
      },
      select: researchRowSelect,
    }).catch((error) => {
      console.warn('[Customer Analysis] Failed to load main product reviews:', error);
      return [];
    }),
    Promise.all([
      competitor1Asin
        ? prisma.researchRow.findMany({
            where: {
              ...baseWhere,
              source: "AMAZON_COMPETITOR_1" as any,
            },
            select: researchRowSelect,
          }).catch((error) => {
            console.warn('[Customer Analysis] Failed to load competitor 1 reviews:', error);
            return [];
          })
        : Promise.resolve([]),
      competitor2Asin
        ? prisma.researchRow.findMany({
            where: {
              ...baseWhere,
              source: "AMAZON_COMPETITOR_2" as any,
            },
            select: researchRowSelect,
          }).catch((error) => {
            console.warn('[Customer Analysis] Failed to load competitor 2 reviews:', error);
            return [];
          })
        : Promise.resolve([]),
      competitor3Asin
        ? prisma.researchRow.findMany({
            where: {
              ...baseWhere,
              source: "AMAZON_COMPETITOR_3" as any,
            },
            select: researchRowSelect,
          }).catch((error) => {
            console.warn('[Customer Analysis] Failed to load competitor 3 reviews:', error);
            return [];
          })
        : Promise.resolve([]),
    ]),
    prisma.researchRow.findMany({
      where: {
        ...baseWhere,
        source: "AMAZON" as any,
      },
      select: researchRowSelect,
    }).catch((error) => {
      console.warn('[Customer Analysis] Failed to load legacy Amazon reviews:', error);
      return [];
    }),
    prisma.researchRow.findMany({
      where: {
        ...baseWhere,
        source: {
          in: ["REDDIT_PRODUCT", "REDDIT_PROBLEM", "UPLOADED"],
        },
      },
      select: researchRowSelect,
    }).catch((error) => {
      console.warn('[Customer Analysis] Failed to load context rows:', error);
      return [];
    }),
  ]);

  const competitorReviewsRaw = competitorReviewsBySource
    .filter((rows) => rows.length > 0)
    .flat();

  const researchRowsRaw = [
    ...mainProductReviewsRaw,
    ...competitorReviewsRaw,
    ...legacyAmazonReviewsRaw,
    ...contextRowsRaw,
  ];
  const competitorReviewRowsRaw = competitorReviewsRaw;

  console.log('[Analysis Debug] Main product review count:', mainProductReviewsRaw.length);
  console.log('[Analysis Debug] Competitor review count:', competitorReviewRowsRaw.length);
  console.log(
    '[Analysis Debug] Sample main product review:',
    (mainProductReviewsRaw[0]?.content ?? '').substring(0, 100),
  );
  console.log(
    '[Analysis Debug] Sample competitor review:',
    (competitorReviewRowsRaw[0]?.content ?? '').substring(0, 100),
  );

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
    ...groupResearchRows(researchRows, productProblemSolved),
    uploadedData,
  };

  const operatorContext = await resolveAnalysisOperatorContext(
    projectId,
    runId,
    args.solutionKeywords,
    args.additionalProblems
  );
  const avatarPrompt = buildCustomerAvatarPrompt(grouped, researchRows.length, operatorContext);
  console.log(
    '[Analysis Debug] Building prompt with',
    mainProductReviews.length,
    'main +',
    competitorReviews.length,
    'competitor reviews'
  );
  console.log('[Analysis Debug] Prompt preview (first 1000 chars):', avatarPrompt.prompt.substring(0, 1000));
  const anthropicResult = await callAnthropic(avatarPrompt.system, avatarPrompt.prompt);
  const avatarText = anthropicResult.content;
  const avatarJson = ensureObject<CustomerAnalysisJSON>(parseJsonFromLLM(avatarText), 'Avatar');

  await archiveExistingAvatars(projectId);
  const avatarRecord = await prisma.customerAvatar.create({
    data: {
      projectId,
      persona: avatarJson as any,
    },
  });
  try {
    const competitiveInsightsJson = JSON.stringify(avatarJson.competitive_analysis ?? null);
    await prisma.$executeRaw`
      UPDATE "customer_avatar"
      SET "competitiveInsights" = ${competitiveInsightsJson}::jsonb
      WHERE "id" = ${avatarRecord.id}
    `;
  } catch (error) {
    console.warn('[Customer Analysis] Failed to persist competitiveInsights column:', error);
  }

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
    productProblemSolved,
    runId,
    summary: {
      avatar: avatarSummary,
    },
    analysisInput: {
      anthropicRequestLogPath: anthropicResult.requestPath,
      anthropicResponseLogPath: anthropicResult.responsePath,
    },
  };
}

export async function purgeCustomerProfileArchives(projectId: string) {
  await purgeExpiredCustomerAvatars(projectId);
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

async function resolveAnalysisOperatorContext(
  projectId: string,
  runId: string,
  explicitSolutionKeywords?: string[],
  explicitAdditionalProblems?: string[]
): Promise<AnalysisOperatorContext> {
  const normalizedSolutionKeywords = normalizeStringArray(explicitSolutionKeywords);
  const normalizedAdditionalProblems = normalizeStringArray(explicitAdditionalProblems);

  if (normalizedSolutionKeywords.length > 0 && normalizedAdditionalProblems.length > 0) {
    return {
      solutionKeywords: normalizedSolutionKeywords,
      additionalProblems: normalizedAdditionalProblems,
    };
  }

  const runResearchJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.CUSTOMER_RESEARCH,
      runId,
    },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });

  const payload = (runResearchJob?.payload ?? {}) as Record<string, unknown>;
  const fallbackSolutionKeywords = normalizeStringArray(payload?.solutionKeywords);
  const fallbackAdditionalProblems = normalizeStringArray(payload?.additionalProblems);

  return {
    solutionKeywords:
      normalizedSolutionKeywords.length > 0 ? normalizedSolutionKeywords : fallbackSolutionKeywords,
    additionalProblems:
      normalizedAdditionalProblems.length > 0 ? normalizedAdditionalProblems : fallbackAdditionalProblems,
  };
}

async function resolveProblemContext(projectId: string, productProblemSolved?: string) {
  let resolvedProblem = productProblemSolved?.trim() ?? '';

  if (resolvedProblem) {
    return { productProblemSolved: resolvedProblem };
  }

  const latestResearchJob = await prisma.job.findFirst({
    where: { projectId, type: JobType.CUSTOMER_RESEARCH },
    orderBy: { createdAt: 'desc' },
  });

  const payload = (latestResearchJob?.payload ?? {}) as Record<string, any>;
  resolvedProblem = resolvedProblem || payload?.valueProp || payload?.productProblemSolved || '';

  return { productProblemSolved: resolvedProblem };
}
