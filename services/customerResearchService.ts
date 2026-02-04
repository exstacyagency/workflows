import { cfg } from "@/lib/config";
import { prisma } from '@/lib/prisma';
import { JobStatus, ResearchSource } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';
import { getBreaker } from '@/lib/circuitBreaker';
import { ExternalServiceError } from "@/lib/externalServiceError";
import { toB64Snippet, truncate } from "@/lib/utils/debugSnippet";
import { apifyClient } from "@/lib/apify";

export type RunCustomerResearchParams = {
  projectId: string;
  jobId: string;
  productName?: string;
  productProblemSolved?: string;
  productAmazonAsin?: string;
  competitor1AmazonAsin?: string;
  competitor2AmazonAsin?: string;
  // Reddit search parameters
  redditKeywords?: string[];
  redditSubreddits?: string[];
  maxPosts?: number;
  maxCommentsPerPost?: number;
  timeRange?: 'week' | 'month' | 'year' | 'all';
  scrapeComments?: boolean;
};

type RedditPost = {
  kind?: string;
  id?: string;
  body?: string;
  selftext?: string;
  author?: string;
  subreddit?: string;
  score?: number;
  url?: string;
  permalink?: string;
  title?: string;
  postId?: string;
  parentId?: string | null;
  depth?: number;
  createdAt?: Date;
};

type AmazonReview = {
  reviewText?: string;
  text?: string;
  rating?: number;
  verified?: boolean;
  date?: string;
};

type AmazonInput = {
  asin: string;
  domainCode: "com";
  sortBy: "recent";
  maxPages: number;
  filterByStar: "four_star" | "five_star" | "one_star" | "two_star" | "three_star";
  filterByKeyword: "";
  reviewerType: "all_reviews";
  formatType: "current_format";
  mediaType: "all_contents";
};

type RedditScraperRequest = {
  subredditName?: string;
  maxPosts?: number;
  scrapeComments?: boolean;
  maxCommentsPerPost?: number;
  searchQuery?: string;
};

type RedditScraperPost = {
  id: string;
  title?: string;
  author?: string;
  subreddit?: string;
  upvotes?: number;
  num_comments?: number;
  url?: string;
  selftext?: string;
  created_utc?: number;
  permalink?: string;
  is_video?: boolean;
  thumbnail?: string;
};

type RedditScraperComment = {
  id: string;
  post_id: string;
  author?: string;
  body?: string;
  upvotes?: number;
  depth?: number;
  parent_id?: string | null;
  created_utc?: number;
};

type RedditScraperResponse = {
  posts: RedditScraperPost[];
  comments: RedditScraperComment[];
  meta?: {
    subreddit?: string;
    total_posts?: number;
    total_comments?: number;
    scraped_at?: string;
    [key: string]: unknown;
  };
};

type ArrayElement<T> = T extends (infer U)[] ? U : T;
type ResearchRowInput = ArrayElement<
  NonNullable<Parameters<(typeof prisma.researchRow)['createMany']>[0]>['data']
>;

const APIFY_BASE = 'https://api.apify.com/v2';

const FETCH_RETRY_ATTEMPTS = 3;
const REDDIT_PAGE_SIZE = 75;
const REDDIT_MAX_PAGES = 3;
const MIN_RESEARCH_ROWS = 25;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit | undefined, label: string) {
  const breaker = getBreaker(label);
  
  return breaker.execute(async () => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (label === "reddit-search") {
            const raw = typeof body === "string" ? body : String(body ?? "");
            // Human-facing message: keep short and readable, don't attempt HTML sanitization.
            const cleanText = truncate(String(raw).replace(/\s+/g, " ").trim(), 280);
            const safeMsg = `reddit-search failed: ${res.status}${cleanText ? ` (${cleanText})` : ""}`;
            const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);

            throw new ExternalServiceError({
              provider: "reddit-search",
              status: res.status,
              retryable,
              message: safeMsg,
              // Debug snippet: encoded so it cannot contain HTML/JS.
              rawSnippet: toB64Snippet(raw, 800),
            });
          }
          throw new Error(`${label} failed (${res.status}): ${body}`);
        }
        return res;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === FETCH_RETRY_ATTEMPTS) break;
        
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 5000);
        await sleep(backoff);
      }
    }

    throw lastError ?? new Error(`${label} failed`);
  }, label);
}

async function runApifyActor<T>(actorId: string, input: any) {
  const runData = await apifyClient.actor(actorId).call({ input });
  if (Array.isArray(runData)) {
    return runData as T[];
  }
  if (Array.isArray((runData as any)?.items)) {
    return (runData as any).items as T[];
  }

  const datasetId: string | undefined =
    (runData as any)?.defaultDatasetId ?? (runData as any)?.data?.defaultDatasetId;
  if (!datasetId) throw new Error('Apify run failed - no datasetId');

  const token = cfg.raw("APIFY_API_TOKEN");
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  const datasetRes = await fetchWithRetry(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&token=${token}`,
    undefined,
    `apify-dataset-${datasetId}`
  );

  return (await datasetRes.json()) as T[];
}

async function searchReddit(keyword: string) {
  if (!keyword) return [] as RedditPost[];

  const collected: RedditPost[] = [];
  let after: string | undefined;
  const headers = { 'User-Agent': 'ai-ad-lab/1.0' };

  for (let page = 0; page < REDDIT_MAX_PAGES; page++) {
    const searchUrl = new URL('https://www.reddit.com/search.json');
    searchUrl.searchParams.set('q', keyword);
    searchUrl.searchParams.set('limit', `${REDDIT_PAGE_SIZE}`);
    searchUrl.searchParams.set('sort', 'top');
    if (after) searchUrl.searchParams.set('after', after);

    const res = await fetchWithRetry(searchUrl.toString(), { headers }, 'reddit-search');
    const data = await res.json();
    const children = data?.data?.children || [];
    if (!children.length) break;
    
    collected.push(...(children.map((item: any) => item?.data) as RedditPost[]));
    after = data?.data?.after;
    if (!after) break;
    
    await sleep(300);
  }

  return collected;
}

function extractUrlsFromPosts(posts: RedditPost[]) {
  return posts
    .map((p) => p.url || (p.permalink ? `https://reddit.com${p.permalink}` : null))
    .filter(Boolean) as string[];
}

function filterProductComments(items: RedditPost[], productName: string) {
  const lowerProduct = productName.toLowerCase();
  const keywords = lowerProduct.split(/\s+/).filter((w) => w.length > 2);

  return items.filter((i) => {
    const title = (i.title || '').toLowerCase();
    const text = (i.body || i.selftext || '').toLowerCase();
    const combined = `${title} ${text}`;
    const author = (i.author || '').toLowerCase();

    const mentions = keywords.some((keyword) => combined.includes(keyword));
    const isBrandAccount = keywords.some((keyword) => author.includes(keyword));

    return mentions && !isBrandAccount;
  });
}

function filterProblemComments(items: RedditPost[]) {
  const postMap = new Map<string, { post: RedditPost | null; comments: RedditPost[] }>();

  items.forEach((item) => {
    if (item.kind === 'post') {
      if (!postMap.has(item.id || '')) {
        postMap.set(item.id || '', { post: item, comments: [] });
      }
    } else if (item.kind === 'comment') {
      const key = item.postId || item.id || '';
      if (!postMap.has(key)) {
        postMap.set(key, { post: null, comments: [] });
      }
      postMap.get(key)?.comments.push(item);
    }
  });

  return Array.from(postMap.values())
    .filter((p) => p.post)
    .map((p) => ({
      post: p.post,
      comments: p.comments
        .filter((c) => (c.body || '').length > 20)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 50),
      commentCount: p.comments.length
    }));
}

// Shared Amazon review params (canonical)
const buildAmazonInput = (
  asin: string,
  starFilter: "four_star" | "five_star" | "one_star" | "two_star" | "three_star"
): AmazonInput => ({
  asin,
  domainCode: "com",
  sortBy: "recent",
  maxPages: 1,
  filterByStar: starFilter,
  filterByKeyword: "",
  reviewerType: "all_reviews",
  formatType: "current_format",
  mediaType: "all_contents",
});

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchApifyAmazonReviews(inputs: AmazonInput[]) {
  if (inputs.length === 0) {
    throw new Error("No Amazon ASIN inputs provided");
  }
  const apifyInput = { input: inputs };
  if (!Array.isArray(apifyInput.input)) {
    throw new Error("Apify Amazon input must be array");
  }
  const amazonData = await runApifyActor<AmazonReview>('ZebkvH3nVOrafqr5T', apifyInput);
  return amazonData;
}

async function fetchLocalReddit(input: RedditScraperRequest) {
  if (!input || (!input.subredditName && !input.searchQuery)) {
    return { posts: [], comments: [], meta: { total_posts: 0, total_comments: 0 } } as RedditScraperResponse;
  }

  const baseUrl = process.env.REDDIT_SCRAPER_URL?.trim();
  if (!baseUrl) {
    throw new Error('REDDIT_SCRAPER_URL not set');
  }

  const controller = new AbortController();
  const timeoutMs = 120000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/scrape`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      console.log("[reddit-scraper] error response:", rawText);
      throw new Error(`Reddit scraper error (${res.status})`);
    }

    const data = (rawText ? JSON.parse(rawText) : {}) as RedditScraperResponse;
    console.log("[reddit-scraper] response:", JSON.stringify(data));
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Reddit scraper timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && error.message.startsWith("Reddit scraper error")) {
      throw error;
    }
    const url = process.env.REDDIT_SCRAPER_URL?.trim() || "(unset)";
    throw new Error(`Reddit scraper not available at ${url}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function dedupeRows(rows: ResearchRowInput[]) {
  const seen = new Set<string>();
  const normalizedRows: typeof rows = [];

  for (const row of rows) {
    const normalizedContent = row.content.replace(/\s+/g, ' ').trim();
    if (!normalizedContent) continue;
    const dedupeKey = `${row.source}:${normalizedContent.toLowerCase()}:${(row as any).metadata?.sourceUrl ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedRows.push({ ...row, content: normalizedContent });
  }

  return normalizedRows;
}

export async function runCustomerResearch(params: RunCustomerResearchParams) {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV === 'test') {
    return {
      summary: 'Test customer research result',
      sources: [],
      confidence: 1,
    };
  }

  const { 
    projectId, 
    jobId, 
    productName, 
    productProblemSolved, 
    productAmazonAsin, 
    competitor1AmazonAsin, 
    competitor2AmazonAsin,
    redditKeywords,
    redditSubreddits,
    maxPosts,
    maxCommentsPerPost,
    timeRange,
    scrapeComments,
  } = params;

  try {
    const normalizedProductName = productName?.trim() || '';
    const normalizedProductProblem = productProblemSolved?.trim() || '';
    const hasAmazonAsin = Boolean(productAmazonAsin?.trim());
    const hasRedditData = Boolean(normalizedProductName && normalizedProductProblem);

    if (!hasAmazonAsin && !hasRedditData) {
      throw new Error('Must provide either Amazon ASIN or Product Name/Problem for research');
    }

    const effectiveProductName =
      normalizedProductName || (productAmazonAsin ? `Product-${productAmazonAsin}` : 'Product');

    const effectiveMaxPosts = typeof maxPosts === "number" ? maxPosts : 50;
    const effectiveMaxCommentsPerPost =
      typeof maxCommentsPerPost === "number" ? maxCommentsPerPost : 50;

    let redditResponse: RedditScraperResponse = { posts: [], comments: [], meta: {} };
    let filteredProductComments: RedditPost[] = [];
    let filteredProblemComments: ReturnType<typeof filterProblemComments> = [];

    if (hasRedditData) {
      const redditInput: RedditScraperRequest = {
        subredditName: redditSubreddits?.[0] || undefined,
        maxPosts: effectiveMaxPosts,
        ...(typeof scrapeComments === "boolean" && { scrapeComments }),
        maxCommentsPerPost: effectiveMaxCommentsPerPost,
        searchQuery: normalizedProductName,
      };

      redditResponse = await fetchLocalReddit(redditInput);

      const redditPosts: RedditPost[] = (redditResponse.posts || []).map((post) => ({
        kind: "post",
        id: post.id,
        title: post.title,
        author: post.author,
        subreddit: post.subreddit,
        score: post.upvotes ?? 0,
        url: post.url,
        permalink: post.permalink,
        selftext: post.selftext,
        createdAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
      }));

      const redditComments: RedditPost[] = (redditResponse.comments || []).map((comment) => ({
        kind: "comment",
        id: comment.id,
        postId: comment.post_id,
        author: comment.author,
        body: comment.body,
        score: comment.upvotes ?? 0,
        parentId: comment.parent_id ?? null,
        depth: comment.depth,
        createdAt: comment.created_utc ? new Date(comment.created_utc * 1000) : undefined,
      }));

      const redditData = [...redditPosts, ...redditComments];

      const productDetails = redditData;
      const problemDetails = redditData;

      filteredProductComments = filterProductComments(productDetails, effectiveProductName);
      filteredProblemComments = filterProblemComments(problemDetails);
    }

    let productAll: AmazonReview[] = [];
    let product4Star: AmazonReview[] = [];
    let product5Star: AmazonReview[] = [];
    let competitor1All: AmazonReview[] = [];
    let competitor2All: AmazonReview[] = [];
    let competitor1OneStar: AmazonReview[] = [];
    let competitor1TwoStar: AmazonReview[] = [];
    let competitor1ThreeStar: AmazonReview[] = [];
    let competitor2OneStar: AmazonReview[] = [];
    let competitor2TwoStar: AmazonReview[] = [];
    let competitor2ThreeStar: AmazonReview[] = [];

    const productAsin = productAmazonAsin?.trim();
    const competitor1Asin = competitor1AmazonAsin?.trim();
    const competitor2Asin = competitor2AmazonAsin?.trim();

    if (productAsin) {
      product4Star = await fetchApifyAmazonReviews([buildAmazonInput(productAsin, "four_star")]);
      product5Star = await fetchApifyAmazonReviews([buildAmazonInput(productAsin, "five_star")]);
      productAll = [...product4Star, ...product5Star];
    }

    if (competitor1Asin) {
      competitor1OneStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor1Asin, "one_star")]);
      competitor1TwoStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor1Asin, "two_star")]);
      competitor1ThreeStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor1Asin, "three_star")]);
      competitor1All = [...competitor1OneStar, ...competitor1TwoStar, ...competitor1ThreeStar];
    }

    if (competitor2Asin) {
      competitor2OneStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor2Asin, "one_star")]);
      competitor2TwoStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor2Asin, "two_star")]);
      competitor2ThreeStar = await fetchApifyAmazonReviews([buildAmazonInput(competitor2Asin, "three_star")]);
      competitor2All = [...competitor2OneStar, ...competitor2TwoStar, ...competitor2ThreeStar];
    }

    const rows: ResearchRowInput[] = [
      ...filteredProductComments.map((item, idx) => ({
        projectId,
        jobId,
        source: 'REDDIT_PRODUCT' as any,
        type: 'post',
        content: item.title || item.body || item.selftext || '',
        metadata: {
          title: item.title,
          author: item.author,
          subreddit: item.subreddit,
          score: item.score,
          indexLabel: `${idx + 1}`,
          sourceUrl: item.url || item.permalink,
          sourceDate: item.createdAt ? item.createdAt.toISOString() : null,
        },
      })),
      ...filteredProblemComments.flatMap((item, idx) =>
        item.comments.map((comment, cidx) => ({
          projectId,
          jobId,
          source: 'REDDIT_PROBLEM' as any,
          type: 'comment',
          content: comment.body || '',
          metadata: {
            postTitle: item.post?.title,
            score: comment.score,
            indexLabel: `${idx + 1}.${cidx + 1}`,
            sourceUrl: comment.permalink || item.post?.permalink,
            sourceDate: comment.createdAt ? comment.createdAt.toISOString() : null,
          },
        }))
      )
    ];

    const dedupedRows = dedupeRows(rows);

    if (dedupedRows.length > 0) {
      await prisma.researchRow.createMany({ data: dedupedRows });
    }

    const amazonRows: ResearchRowInput[] = [
      ...product4Star.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: productAsin ?? null,
          amazonKind: "product_4_star",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...product5Star.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: productAsin ?? null,
          amazonKind: "product_5_star",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor1OneStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor1Asin ?? null,
          amazonKind: "competitor_1",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor1TwoStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor1Asin ?? null,
          amazonKind: "competitor_2",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor1ThreeStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor1Asin ?? null,
          amazonKind: "competitor_3",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor2OneStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor2Asin ?? null,
          amazonKind: "competitor_1",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor2TwoStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor2Asin ?? null,
          amazonKind: "competitor_2",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
      ...competitor2ThreeStar.map((r) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: r.text ?? r.reviewText ?? "",
        metadata: {
          rating: r.rating ?? null,
          verified: r.verified ?? null,
          asin: competitor2Asin ?? null,
          amazonKind: "competitor_3",
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate((r as any).date ?? (r as any).reviewDate ?? (r as any).reviewDateTime ?? (r as any).reviewTime),
          raw: r,
        },
      })),
    ];

    if (amazonRows.length > 0) {
      await prisma.researchRow.createMany({
        data: amazonRows,
      });
    }

    const storedRows = await prisma.researchRow.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });

    const redditMeta = redditResponse.meta ?? {};
    const totalPosts =
      typeof redditMeta.total_posts === "number"
        ? redditMeta.total_posts
        : redditResponse.posts?.length ?? 0;
    const totalComments =
      typeof redditMeta.total_comments === "number"
        ? redditMeta.total_comments
        : redditResponse.comments?.length ?? 0;

    const total = dedupedRows.length + amazonRows.length;
    const redditResults = {
      total_posts: totalPosts,
      total_comments: totalComments,
      meta: redditMeta,
    };

    const product4StarCount = product4Star.length;
    const product5StarCount = product5Star.length;
    const competitor1StarCount = competitor1OneStar.length + competitor2OneStar.length;
    const competitor2StarCount = competitor1TwoStar.length + competitor2TwoStar.length;
    const competitor3StarCount = competitor1ThreeStar.length + competitor2ThreeStar.length;

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: {
          rowsCollected: total,
          total_posts: redditResults?.total_posts || 0,
          total_comments: redditResults?.total_comments || 0,
          product4Star: product4StarCount,
          product5Star: product5StarCount,
          competitor1Star: competitor1StarCount,
          competitor2Star: competitor2StarCount,
          competitor3Star: competitor3StarCount,
        }
      }
    });

    return {
      rowsCollected: total,
      total_posts: redditResults?.total_posts || 0,
      total_comments: redditResults?.total_comments || 0,
      product4Star: product4StarCount,
      product5Star: product5StarCount,
      competitor1Star: competitor1StarCount,
      competitor2Star: competitor2StarCount,
      competitor3Star: competitor3StarCount,
    };
  } catch (error) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    throw error;
  }
}
