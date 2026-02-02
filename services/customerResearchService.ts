import { cfg } from "@/lib/config";
import { prisma } from '@/lib/prisma';
import { JobStatus, ResearchSource } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';
import { getBreaker } from '@/lib/circuitBreaker';
import { ExternalServiceError } from "@/lib/externalServiceError";
import { toB64Snippet, truncate } from "@/lib/utils/debugSnippet";

export type RunCustomerResearchParams = {
  projectId: string;
  jobId: string;
  productName: string;
  productProblemSolved: string;
  productAmazonAsin: string;
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
  const token = cfg.raw("APIFY_API_TOKEN");
  if (!token) throw new Error('APIFY_API_TOKEN not set');

  const payload = input;

  const runResponse = await fetchWithRetry(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=120`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    `apify-${actorId}`
  );

  const runData = await runResponse.json();
  const datasetId: string | undefined = runData?.data?.defaultDatasetId;
  if (!datasetId) throw new Error('Apify run failed - no datasetId');

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

function scoreReview(text: string) {
  if (!text || text.length < 150) return 0;

  let score = 0;
  if (/\b(I am|I feel|I finally|I can now|I'm not|I've become|used to be|no longer)\b/i.test(text)) score += 3;
  if (/\b(husband|wife|friend|coworker|stranger|asked|said|noticed|commented|told me|people)\b/i.test(text)) score += 3;
  if (/\b(avoid|hide|can't|couldn't|stopped|used to|never|afraid|embarrassed|ashamed)\b/i.test(text)) score += 2;
  if (/\b(wedding|photo|mirror|date|interview|event|job|party|vacation)\b/i.test(text)) score += 2;
  if (/\b(after|before|now|finally|weeks|months|years)\b/i.test(text)) score += 1;
  if (text.length > 400) score += 1;
  if (text.length > 800) score += 1;
  return score;
}

function processReviews(reviews: AmazonReview[], minScore: number) {
  return reviews
    .filter((r) => r.reviewText || r.text)
    .map((r) => {
      const text = (r.reviewText || r.text || '').trim();
      const cinematicScore = scoreReview(text);
      return {
        text,
        rating: r.rating,
        verified: r.verified || false,
        date: r.date,
        cinematicScore,
        wordCount: text.split(' ').length
      };
    })
    .filter((r) => r.cinematicScore >= minScore)
    .sort((a, b) => b.cinematicScore - a.cinematicScore);
}

async function fetchApifyAmazonReviews(asin: string) {
  if (!asin) return [] as AmazonReview[];
  const amazonInput = {
    asin,
    domainCode: 'com',
    sortBy: 'recent',
    maxPages: 5,
    filterByStar: 'all_stars',
    filterByKeyword: '',
    reviewerType: 'all_reviews',
    formatType: 'current_format',
    mediaType: 'all_contents'
  };
  console.log('=== FETCHING AMAZON REVIEWS ===');
  console.log('ASIN:', asin);
  console.log('Input:', JSON.stringify(amazonInput, null, 2));
  console.log('Calling Amazon actor...');
  const amazonData = await runApifyActor<AmazonReview>('ZebkvH3nVOrafqr5T', amazonInput);
  console.log('Amazon actor returned:', amazonData.length, 'reviews');
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
    if (!productName || !productProblemSolved) {
      throw new Error('productName, productProblemSolved required');
    }

    const effectiveMaxPosts = typeof maxPosts === "number" ? maxPosts : 50;
    const effectiveMaxCommentsPerPost =
      typeof maxCommentsPerPost === "number" ? maxCommentsPerPost : 50;

    const redditInput: RedditScraperRequest = {
      subredditName: redditSubreddits?.[0] || undefined,
      maxPosts: effectiveMaxPosts,
      ...(typeof scrapeComments === "boolean" && { scrapeComments }),
      maxCommentsPerPost: effectiveMaxCommentsPerPost,
      searchQuery: productName,
    };

    const redditResponse = await fetchLocalReddit(redditInput);

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
    
    // Split results for filtering (use all data for both)
    const productDetails = redditData;
    const problemDetails = redditData;

    const filteredProductComments = filterProductComments(productDetails, productName);
    const filteredProblemComments = filterProblemComments(problemDetails);

    let productAll: AmazonReview[] = [];
    let competitor1All: AmazonReview[] = [];
    let competitor2All: AmazonReview[] = [];

    if (productAmazonAsin) {
      [productAll, competitor1All, competitor2All] = await Promise.all([
        fetchApifyAmazonReviews(productAmazonAsin),
        competitor1AmazonAsin ? fetchApifyAmazonReviews(competitor1AmazonAsin) : Promise.resolve([]),
        competitor2AmazonAsin ? fetchApifyAmazonReviews(competitor2AmazonAsin) : Promise.resolve([])
      ]);
    }

    const filterByRating = (reviews: AmazonReview[], ratingTarget: number) =>
      reviews.filter((r) => Number(r.rating) === ratingTarget);

    const product5Star = filterByRating(productAll, 5);
    const product4Star = filterByRating(productAll, 4);
    const competitor1 = filterByRating(competitor1All, 1);
    const competitor2 = filterByRating(competitor2All, 1);

    const processed5Star = processReviews(product5Star, 4);
    const processed4Star = processReviews(product4Star, 4);
    const processedCompetitor1 = processReviews(competitor1, 2);
    const processedCompetitor2 = processReviews(competitor2, 2);

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
          },
        }))
      ),
      ...processed5Star.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: 'review',
        content: r.text,
        metadata: { date: r.date, wordCount: r.wordCount, amazonKind: 'product_5_star', rating: r.rating, verified: r.verified, indexLabel: `${idx + 1}` }
      })),
      ...processed4Star.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: 'review',
        content: r.text,
        metadata: { date: r.date, wordCount: r.wordCount, amazonKind: 'product_4_star', rating: r.rating, verified: r.verified, indexLabel: `${idx + 1}` }
      })),
      ...processedCompetitor1.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: 'review',
        content: r.text,
        metadata: { date: r.date, wordCount: r.wordCount, amazonKind: 'competitor_1', rating: r.rating, verified: r.verified, indexLabel: `${idx + 1}` }
      })),
      ...processedCompetitor2.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: 'review',
        content: r.text,
        metadata: { date: r.date, wordCount: r.wordCount, amazonKind: 'competitor_2', rating: r.rating, verified: r.verified, indexLabel: `${idx + 1}` }
      }))
    ];

    const dedupedRows = dedupeRows(rows);

    const storedRows = await prisma.$transaction(async (tx) => {
      if (dedupedRows.length > 0) {
        await tx.researchRow.createMany({ data: dedupedRows });
      }
      return tx.researchRow.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
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

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: {
          rowsCollected: dedupedRows.length,
          reddit: {
            total_posts: totalPosts,
            total_comments: totalComments,
            meta: redditMeta
          }
        }
      }
    });

    return storedRows;
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
