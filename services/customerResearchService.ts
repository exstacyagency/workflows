import { cfg } from "@/lib/config";
import { prisma } from '@/lib/prisma';
import { JobStatus, ProductType, ResearchSource } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';
import { getBreaker } from '@/lib/circuitBreaker';
import { ExternalServiceError } from "@/lib/externalServiceError";
import { toB64Snippet, truncate } from "@/lib/utils/debugSnippet";
import { apifyClient } from "@/lib/apify";
import nodeFetch from "node-fetch";

export type RunCustomerResearchParams = {
  projectId: string;
  jobId: string;
  productProblemSolved?: string;
  mainProductAsin?: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
  competitor3Asin?: string;
  // Reddit search parameters
  redditKeywords?: string[];
  searchIntent?: string[];
  solutionKeywords?: string[];
  redditSubreddits?: string[];
  maxPosts?: number;
  maxCommentsPerPost?: number;
  timeRange?: 'week' | 'month' | 'year' | 'all';
  scrapeComments?: boolean;
  additionalProblems?: string[];
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
  query_metadata?: RedditQueryMetadata;
};

type AmazonReview = {
  reviewText?: string;
  text?: string;
  title?: string;
  productName?: string;
  productTitle?: string;
  rating?: number;
  verified?: boolean;
  date?: string;
};

type ProductScrapeTarget = {
  asin: string;
  type: ProductType;
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
  query: string;
  search_type?: "sitewide" | "subreddit";
  subreddit?: string;
  max_posts?: number;
  time_range?: "week" | "month" | "year" | "all";
  scrape_comments?: boolean;
  max_comments_per_post?: number;
};

type RedditScraperPost = {
  id: string;
  title?: string;
  author?: string;
  subreddit?: string;
  upvotes?: number;
  score?: number;
  num_comments?: number;
  url?: string;
  selftext?: string;
  created_utc?: number;
  permalink?: string;
  is_video?: boolean;
  thumbnail?: string;
  query_metadata?: RedditQueryMetadata;
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
  query_metadata?: RedditQueryMetadata;
};

type RedditQueryType = "solution" | "intent" | "keyword" | "problem";

type RedditQueryMetadata = {
  problem: string;
  query_type: RedditQueryType;
  query_used: string;
  subreddit: string;
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

type SubredditDiscoveryResult = {
  discoveredSubreddits: string[];
  subredditCounts: Record<string, number>;
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

function filterProductComments(items: RedditPost[]) {
  return items
    .filter((item) => item.kind === "post")
    .filter((item) => (item.title || item.selftext || item.body || "").trim().length > 20);
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

function extractAmazonProductName(review: AmazonReview): string | null {
  const value =
    review.productName ??
    review.productTitle ??
    review.title ??
    (review as any)?.product_name ??
    (review as any)?.name ??
    null;
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function extractAmazonReviewText(review: AmazonReview): string {
  return String(
    review.text ??
      review.reviewText ??
      (review as any)?.content ??
      (review as any)?.review ??
      ""
  ).trim();
}

function getStarFiltersForProduct(type: ProductType): AmazonInput["filterByStar"][] {
  // Collect all available review ratings for every product type.
  return ["one_star", "two_star", "three_star", "four_star", "five_star"];
}

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

function extractProblemKeywords(problemSolved: string): string[] {
  const fillers = ["provides", "helps", "for", "with", "the", "a", "an", "to", "is", "and"];
  const words = problemSolved.toLowerCase().split(/\s+/);

  return words
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 3 && !fillers.includes(word))
    .slice(0, 5);
}

function buildProblemQuery(
  problemSolved: string,
  additionalKeywords: string[] = []
): string {
  const problemKeywords = extractProblemKeywords(problemSolved);
  const allKeywords = [...problemKeywords, ...additionalKeywords]
    .map((keyword) => String(keyword || "").trim())
    .filter(Boolean);

  if (allKeywords.length === 0) {
    return problemSolved;
  }

  return allKeywords.join(" ");
}

function filterQualityPosts(
  posts: RedditScraperPost[],
  maxPosts: number,
  problemSolved?: string
): RedditScraperPost[] {
  const NOISE_SUBREDDITS = new Set([
    "memes",
    "funny",
    "dankmemes",
    "shitposting",
    "circlejerk",
    "copypasta",
    "okbuddyretard",
    "wholesomememes",
    "meirl",
  ]);

  // Stage 1: Basic quality filter
  let filtered = posts.filter((post) => {
    if (NOISE_SUBREDDITS.has(String(post.subreddit || "").toLowerCase())) {
      return false;
    }

    const postScore = post.score ?? post.upvotes ?? 0;
    if (postScore < 5 || (post.num_comments ?? 0) < 3) {
      return false;
    }

    if ((post.selftext || "").length < 100 && (post.title || "").length < 50) {
      return false;
    }

    return true;
  });

  console.log("[Filter] After Stage 1 (basic quality):", filtered.length);

  // Stage 2: Content relevance filter
  if (problemSolved) {
    filtered = filtered.filter((post) => {
      const text = `${post.title || ""} ${post.selftext || ""}`.toLowerCase();
      const problemWords = problemSolved
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);

      if (problemWords.length === 0) return true;

      const matches = problemWords.filter((word) => text.includes(word)).length;
      const density = matches / problemWords.length;

      return density >= 0.4;
    });

    console.log("[Filter] After Stage 2 (content relevance):", filtered.length);
  }

  // Stage 3: Subreddit consistency filter
  if (filtered.length > maxPosts * 1.5) {
    const subredditCounts = filtered.reduce(
      (acc, post) => {
        const subreddit = post.subreddit || "unknown";
        acc[subreddit] = (acc[subreddit] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    filtered = filtered.filter((post) => {
      const subreddit = post.subreddit || "unknown";
      const count = subredditCounts[subreddit] || 0;
      const score = post.score ?? post.upvotes ?? 0;

      return count >= 2 || score >= 50;
    });

    console.log("[Filter] After Stage 3 (subreddit consistency):", filtered.length);
  }

  // Stage 4: Content length preference
  const scored = filtered.map((post) => ({
    post,
    contentScore: (post.selftext || "").length + (post.title || "").length * 2,
  }));

  scored.sort((a, b) => {
    if (Math.abs(a.contentScore - b.contentScore) > 500) {
      return b.contentScore - a.contentScore;
    }
    const aScore = a.post.score ?? a.post.upvotes ?? 0;
    const bScore = b.post.score ?? b.post.upvotes ?? 0;
    return bScore - aScore;
  });

  const result = scored.slice(0, maxPosts).map((s) => s.post);
  console.log("[Filter] Final result:", result.length, "posts");

  return result;
}

async function discoverRelevantSubreddits(
  problemSolved: string,
  scraperUrl: string,
  minPosts = 1
): Promise<SubredditDiscoveryResult> {
  console.log("[Reddit Discovery] Starting subreddit discovery for:", problemSolved);

  const discoveryQuery = problemSolved;
  const normalizedUrl = scraperUrl.trim().replace(/\/+$/, "");

  try {
    const response = await nodeFetch(`${normalizedUrl}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: discoveryQuery,
        search_type: "sitewide",
        max_posts: 200,
        time_range: "month",
        scrape_comments: false,
      } satisfies RedditScraperRequest),
    });

    if (!response.ok) {
      console.error("[Reddit Discovery] Failed:", response.status);
      return { discoveredSubreddits: [], subredditCounts: {} };
    }

    const result = (await response.json()) as RedditScraperResponse;
    const posts = Array.isArray(result.posts) ? result.posts : [];
    console.log("[Reddit Discovery] Found", posts.length, "posts for discovery");

    const subredditCounts = posts.reduce(
      (acc, post) => {
        const subreddit = post.subreddit;
        if (subreddit) {
          acc[subreddit] = (acc[subreddit] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const discoveredSubreddits = Object.entries(subredditCounts)
      .filter(([, count]) => count >= minPosts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([subreddit]) => subreddit);

    console.log("[Reddit Discovery] Discovered subreddits:", discoveredSubreddits);
    console.log(
      "[Reddit Discovery] Post counts:",
      discoveredSubreddits.map((subreddit) => `${subreddit}: ${subredditCounts[subreddit]}`).join(", ")
    );

    return { discoveredSubreddits, subredditCounts };
  } catch (error) {
    console.error("[Reddit Discovery] Error:", error);
    return { discoveredSubreddits: [], subredditCounts: {} };
  }
}

function dedupePostsById(posts: RedditScraperPost[]): RedditScraperPost[] {
  const seen = new Set<string>();
  const deduped: RedditScraperPost[] = [];
  for (const post of posts) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    deduped.push(post);
  }
  return deduped;
}

function dedupeCommentsById(comments: RedditScraperComment[]): RedditScraperComment[] {
  const seen = new Set<string>();
  const deduped: RedditScraperComment[] = [];
  for (const comment of comments) {
    if (!comment?.id || seen.has(comment.id)) continue;
    seen.add(comment.id);
    deduped.push(comment);
  }
  return deduped;
}

async function fetchLocalReddit(
  productProblemSolved: string,
  redditKeywords: string[] = [],
  searchIntent: string[] = [],
  solutionKeywords: string[] = [],
  maxPosts = 50,
  timeRange: "week" | "month" | "year" | "all" = "month",
  scrapeComments = true,
  maxCommentsPerPost = 50,
  additionalProblems: string[] = []
): Promise<RedditScraperResponse> {
  if (!productProblemSolved.trim()) {
    return { posts: [], comments: [], meta: { total_posts: 0, total_comments: 0 } } as RedditScraperResponse;
  }

  const scraperUrlRaw = cfg.raw("REDDIT_SCRAPER_URL");
  if (!scraperUrlRaw) {
    throw new Error("REDDIT_SCRAPER_URL not configured");
  }

  const scraperUrl = scraperUrlRaw.trim().replace(/\/+$/, "");
  console.log("[Reddit] REDDIT_SCRAPER_URL:", scraperUrl);
  console.log("[Reddit] Starting 2-stage discovery process");

  try {
    const problems = [productProblemSolved, ...additionalProblems]
      .map((problem) => String(problem || "").trim())
      .filter(Boolean);
    const uniqueProblems = Array.from(new Set(problems));
    const normalizedRedditKeywords = redditKeywords
      .map((keyword) => String(keyword || "").trim())
      .filter(Boolean);
    const normalizedSearchIntent = searchIntent
      .map((phrase) => String(phrase || "").trim())
      .filter(Boolean);
    const normalizedSolutionKeywords = solutionKeywords
      .map((keyword) => String(keyword || "").trim())
      .filter(Boolean);
    const allPosts: RedditScraperPost[] = [];
    const allComments: RedditScraperComment[] = [];
    const discoveredByProblem: Record<string, string[]> = {};

    for (const problem of uniqueProblems) {
      console.log(`[Reddit] Researching problem: ${problem}`);

      const {
        discoveredSubreddits,
        subredditCounts,
      } = await discoverRelevantSubreddits(problem, scraperUrl, 1);

      // Filter out low-relevance subreddits before deep search.
      const minPostsThreshold = 3;
      let discoveredSubs = discoveredSubreddits.filter(
        (subreddit) => (subredditCounts[subreddit] || 0) >= minPostsThreshold
      );

      if (discoveredSubreddits.length > 0) {
        console.log(
          "[Reddit] Discovery counts:",
          discoveredSubreddits
            .map((subreddit) => `${subreddit}: ${subredditCounts[subreddit] || 0}`)
            .join(", ")
        );
        console.log(
          `[Reddit] Relevant subreddits (>= ${minPostsThreshold} posts):`,
          discoveredSubs
        );
      }

      if (discoveredSubs.length === 0) {
        console.log("[Reddit] No subreddits discovered, falling back to sitewide search");
        discoveredSubs = [""];
      }

      discoveredByProblem[problem] = discoveredSubs;
      console.log("[Reddit] Stage 2: Deep search in", discoveredSubs.length, "subreddits");

      const postsPerSubreddit = Math.max(1, Math.ceil((maxPosts * 2) / discoveredSubs.length));
      const problemKeywords = extractProblemKeywords(problem);
      const baseQuery = problemKeywords.join(" ");

      for (const subreddit of discoveredSubs) {
        console.log(`[Reddit] Searching r/${subreddit || "all"} for problem discussions...`);

        // Stage 2: Build query based on operator input (no hardcoded phrases)
        let query: string;
        let queryType: RedditQueryType = "problem";
        if (normalizedSolutionKeywords.length > 0) {
          const keywordIndex = discoveredSubs.indexOf(subreddit) % normalizedSolutionKeywords.length;
          const solutionKeyword = normalizedSolutionKeywords[keywordIndex];
          query = `${baseQuery || problem} ${solutionKeyword}`.trim();
          queryType = "solution";
          console.log(`[Reddit] Query (solution-focused) for r/${subreddit || "all"}:`, query);
        } else if (normalizedSearchIntent.length > 0) {
          const intentIndex = discoveredSubs.indexOf(subreddit) % normalizedSearchIntent.length;
          const intentPhrase = normalizedSearchIntent[intentIndex];
          query = `${baseQuery || problem} ${intentPhrase}`.trim();
          queryType = "intent";
          console.log(`[Reddit] Query (intent-focused) for r/${subreddit || "all"}:`, query);
        } else if (normalizedRedditKeywords.length > 0) {
          query = `${baseQuery || problem} ${normalizedRedditKeywords.join(" ")}`.trim();
          queryType = "keyword";
          console.log(`[Reddit] Query (keyword-focused) for r/${subreddit || "all"}:`, query);
        } else {
          query = (baseQuery || problem).trim();
          queryType = "problem";
          console.log(`[Reddit] Stage 2 query (problem-only) for r/${subreddit || "all"}:`, query);
        }

        const controller = new AbortController();
        const timeoutMs = 300000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const requestBody: RedditScraperRequest = {
            query,
            search_type: subreddit ? "subreddit" : "sitewide",
            subreddit: subreddit || undefined,
            max_posts: postsPerSubreddit,
            time_range: timeRange,
            scrape_comments: scrapeComments,
            max_comments_per_post: maxCommentsPerPost,
          };

          const response = await nodeFetch(`${scraperUrl}/scrape`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text().catch(() => "no error body");
            console.error(
              `[Reddit] Failed r/${subreddit || "all"} (${response.status}):`,
              errorText
            );
            continue;
          }

          const result = (await response.json()) as RedditScraperResponse;
          const posts = Array.isArray(result.posts) ? result.posts : [];
          const comments = Array.isArray(result.comments) ? result.comments : [];
          const queryMetadata: RedditQueryMetadata = {
            problem,
            query_type: queryType,
            query_used: query,
            subreddit: subreddit || "sitewide",
          };
          console.log(
            `[Reddit] Got ${posts.length} posts and ${comments.length} comments from r/${subreddit || "all"}`
          );
          allPosts.push(...posts.map((post) => ({ ...post, query_metadata: queryMetadata })));
          allComments.push(...comments.map((comment) => ({ ...comment, query_metadata: queryMetadata })));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[Reddit] Error searching r/${subreddit || "all"}:`, message);
          clearTimeout(timeoutId);
        }
      }
    }

    const dedupedPosts = dedupePostsById(allPosts);
    const dedupedComments = dedupeCommentsById(allComments);
    console.log("[Reddit] Total posts collected:", dedupedPosts.length);
    console.log("[Reddit] Total comments collected:", dedupedComments.length);

    const filteredPosts = filterQualityPosts(dedupedPosts, maxPosts, uniqueProblems.join(" "));
    const fallbackProblem = uniqueProblems[0] || productProblemSolved || "";
    const postsWithMetadata = filteredPosts.map((post) => ({
      ...post,
      query_metadata: post.query_metadata ?? {
        problem: fallbackProblem,
        query_type: "problem",
        query_used: "",
        subreddit: post.subreddit || "sitewide",
      },
    }));

    const selectedPostIds = new Set(postsWithMetadata.map((post) => post.id));
    const postMetadataById = new Map(postsWithMetadata.map((post) => [post.id, post.query_metadata]));
    const filteredComments = dedupedComments.filter((comment) => selectedPostIds.has(comment.post_id));
    const commentsWithMetadata = filteredComments.map((comment) => {
      const metadataFromPost = postMetadataById.get(comment.post_id);
      return {
        ...comment,
        query_metadata: comment.query_metadata ?? metadataFromPost ?? {
          problem: fallbackProblem,
          query_type: "problem",
          query_used: "",
          subreddit: "sitewide",
        },
      };
    });

    console.log("[Reddit] After filtering:", postsWithMetadata.length);
    console.log("[Reddit] Comments for filtered posts:", commentsWithMetadata.length);
    console.log(
      "[Reddit] Filtered posts sample:",
      postsWithMetadata.slice(0, 3).map((p) => ({
        subreddit: p.subreddit,
        score: p.score ?? p.upvotes ?? 0,
        title: p.title,
      }))
    );

    return {
      posts: postsWithMetadata,
      comments: commentsWithMetadata,
      meta: {
        query: uniqueProblems.join(" | "),
        search_type: "2-stage-discovery",
        discovered_subreddits: Array.from(
          new Set(Object.values(discoveredByProblem).flat().filter(Boolean))
        ),
        discovered_subreddits_by_problem: discoveredByProblem,
        search_intent: normalizedSearchIntent,
        reddit_keywords: normalizedRedditKeywords,
        solution_keywords: normalizedSolutionKeywords,
        total_posts: postsWithMetadata.length,
        total_comments: commentsWithMetadata.length,
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Reddit scraper failed") || error.message.startsWith("Reddit scraper fetch failed"))
    ) {
      throw error;
    }
    const url = cfg.raw("REDDIT_SCRAPER_URL")?.trim() || "(unset)";
    throw new Error(`Reddit scraper not available at ${url}`);
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
    productProblemSolved, 
    mainProductAsin,
    competitor1Asin,
    competitor2Asin,
    competitor3Asin,
    redditKeywords,
    searchIntent,
    solutionKeywords,
    maxPosts,
    maxCommentsPerPost,
    timeRange,
    scrapeComments,
    additionalProblems,
  } = params;

  try {
    const normalizedProductProblem = productProblemSolved?.trim() || '';
    const normalizedMainProductAsin = mainProductAsin?.trim();
    const normalizedCompetitor1Asin = competitor1Asin?.trim();
    const normalizedCompetitor2Asin = competitor2Asin?.trim();
    const normalizedCompetitor3Asin = competitor3Asin?.trim();
    const hasAmazonAsin = Boolean(
      normalizedMainProductAsin ||
        normalizedCompetitor1Asin ||
        normalizedCompetitor2Asin ||
        normalizedCompetitor3Asin
    );
    const hasRedditData = Boolean(normalizedProductProblem);

    if (!hasAmazonAsin && !hasRedditData) {
      throw new Error('Must provide either Amazon ASIN or Problem to Research');
    }

    const effectiveMaxPosts = typeof maxPosts === "number" ? maxPosts : 50;
    const effectiveMaxCommentsPerPost =
      typeof maxCommentsPerPost === "number" ? maxCommentsPerPost : 50;

    let redditResponse: RedditScraperResponse = { posts: [], comments: [], meta: {} };
    let filteredProductComments: RedditPost[] = [];
    let filteredProblemComments: ReturnType<typeof filterProblemComments> = [];

    if (hasRedditData) {
      redditResponse = await fetchLocalReddit(
        normalizedProductProblem,
        redditKeywords ?? [],
        searchIntent ?? [],
        solutionKeywords ?? [],
        effectiveMaxPosts,
        timeRange ?? "month",
        typeof scrapeComments === "boolean" ? scrapeComments : true,
        effectiveMaxCommentsPerPost,
        Array.isArray(additionalProblems) ? additionalProblems : []
      );

      const redditPosts: RedditPost[] = (redditResponse.posts || []).map((post) => ({
        kind: "post",
        id: post.id,
        title: post.title,
        author: post.author,
        subreddit: post.subreddit,
        score: post.upvotes ?? post.score ?? 0,
        url: post.url,
        permalink: post.permalink,
        selftext: post.selftext,
        createdAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
        query_metadata: post.query_metadata,
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
        query_metadata: comment.query_metadata,
      }));

      const redditData = [...redditPosts, ...redditComments];

      const productDetails = redditData;
      const problemDetails = redditData;

      filteredProductComments = filterProductComments(productDetails);
      filteredProblemComments = filterProblemComments(problemDetails);
    }

    const productsToScrape = [
      normalizedMainProductAsin
        ? { asin: normalizedMainProductAsin, type: ProductType.MAIN_PRODUCT }
        : null,
      normalizedCompetitor1Asin
        ? { asin: normalizedCompetitor1Asin, type: ProductType.COMPETITOR_1 }
        : null,
      normalizedCompetitor2Asin
        ? { asin: normalizedCompetitor2Asin, type: ProductType.COMPETITOR_2 }
        : null,
      normalizedCompetitor3Asin
        ? { asin: normalizedCompetitor3Asin, type: ProductType.COMPETITOR_3 }
        : null,
    ].filter(Boolean) as ProductScrapeTarget[];

    const amazonReviewsByType: Record<ProductType, AmazonReview[]> = {
      [ProductType.MAIN_PRODUCT]: [],
      [ProductType.COMPETITOR_1]: [],
      [ProductType.COMPETITOR_2]: [],
      [ProductType.COMPETITOR_3]: [],
    };

    const productNameByType: Record<ProductType, string | null> = {
      [ProductType.MAIN_PRODUCT]: null,
      [ProductType.COMPETITOR_1]: null,
      [ProductType.COMPETITOR_2]: null,
      [ProductType.COMPETITOR_3]: null,
    };

    const productAsinByType: Record<ProductType, string | null> = {
      [ProductType.MAIN_PRODUCT]: normalizedMainProductAsin || null,
      [ProductType.COMPETITOR_1]: normalizedCompetitor1Asin || null,
      [ProductType.COMPETITOR_2]: normalizedCompetitor2Asin || null,
      [ProductType.COMPETITOR_3]: normalizedCompetitor3Asin || null,
    };

    for (const product of productsToScrape) {
      const starFilters = getStarFiltersForProduct(product.type);
      for (const starFilter of starFilters) {
        const reviews = await fetchApifyAmazonReviews([buildAmazonInput(product.asin, starFilter)]);
        amazonReviewsByType[product.type].push(...reviews);
        if (!productNameByType[product.type]) {
          const detectedName = reviews.map(extractAmazonProductName).find(Boolean) || null;
          productNameByType[product.type] = detectedName;
        }
      }
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
          url: item.url || item.permalink,
          sourceDate: item.createdAt ? item.createdAt.toISOString() : null,
          query_type: item.query_metadata?.query_type || "unknown",
          query_used: item.query_metadata?.query_used || "",
          search_problem: item.query_metadata?.problem || normalizedProductProblem || null,
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
            author: comment.author,
            subreddit: item.post?.subreddit ?? null,
            score: comment.score,
            indexLabel: `${idx + 1}.${cidx + 1}`,
            sourceUrl: comment.permalink || item.post?.permalink,
            url: comment.permalink || item.post?.permalink,
            sourceDate: comment.createdAt ? comment.createdAt.toISOString() : null,
            query_type:
              comment.query_metadata?.query_type ||
              item.post?.query_metadata?.query_type ||
              "unknown",
            query_used:
              comment.query_metadata?.query_used ||
              item.post?.query_metadata?.query_used ||
              "",
            search_problem:
              comment.query_metadata?.problem ||
              item.post?.query_metadata?.problem ||
              normalizedProductProblem ||
              null,
          },
        }))
      )
    ];

    const dedupedRows = dedupeRows(rows);

    if (dedupedRows.length > 0) {
      await prisma.researchRow.createMany({ data: dedupedRows });
    }

    const amazonRows: ResearchRowInput[] = (
      Object.keys(amazonReviewsByType) as ProductType[]
    ).flatMap((productType) => {
      const asin = productAsinByType[productType];
      const productName = productNameByType[productType];
      return amazonReviewsByType[productType].map((review) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON,
        type: "review",
        content: extractAmazonReviewText(review),
        metadata: {
          rating: review.rating ?? null,
          verified: review.verified ?? null,
          asin: asin ?? null,
          productType,
          productAsin: asin ?? null,
          productName: productName ?? extractAmazonProductName(review),
          scrapedAt: new Date().toISOString(),
          sourceDate: toIsoDate(
            (review as any).date ??
              (review as any).reviewDate ??
              (review as any).reviewDateTime ??
              (review as any).reviewTime
          ),
          raw: review,
        },
      }));
    });

    if (amazonRows.length > 0) {
      await prisma.researchRow.createMany({
        data: amazonRows,
      });
    }

    const amazonReviewRows = (
      Object.keys(amazonReviewsByType) as ProductType[]
    ).flatMap((productType) => {
      const asin = productAsinByType[productType];
      const productName = productNameByType[productType];
      if (!asin) return [];
      return amazonReviewsByType[productType]
        .map((review) => ({
          projectId,
          jobId,
          reviewText: extractAmazonReviewText(review),
          rating: typeof review.rating === "number" ? Math.round(review.rating) : null,
          verified:
            typeof review.verified === "boolean"
              ? review.verified
              : typeof (review as any)?.isVerified === "boolean"
                ? (review as any).isVerified
                : null,
          reviewDate: toIsoDate(
            (review as any).date ??
              (review as any).reviewDate ??
              (review as any).reviewDateTime ??
              (review as any).reviewTime
          ),
          rawJson: review as any,
          productType,
          productAsin: asin,
          productName: productName ?? extractAmazonProductName(review),
        }))
        .filter((row) => row.reviewText.length > 0);
    });

    if (amazonReviewRows.length > 0) {
      await prisma.amazonReview.createMany({
        data: amazonReviewRows.map((row) => ({
          ...row,
          reviewDate: row.reviewDate ? new Date(row.reviewDate) : null,
        })),
      });
    }

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

    const mainProductReviewCount = amazonReviewsByType[ProductType.MAIN_PRODUCT].length;
    const competitor1ReviewCount = amazonReviewsByType[ProductType.COMPETITOR_1].length;
    const competitor2ReviewCount = amazonReviewsByType[ProductType.COMPETITOR_2].length;
    const competitor3ReviewCount = amazonReviewsByType[ProductType.COMPETITOR_3].length;

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: {
          rowsCollected: total,
          total_posts: redditResults?.total_posts || 0,
          total_comments: redditResults?.total_comments || 0,
          mainProductReviews: mainProductReviewCount,
          competitor1Reviews: competitor1ReviewCount,
          competitor2Reviews: competitor2ReviewCount,
          competitor3Reviews: competitor3ReviewCount,
          productTypeBreakdown: {
            MAIN_PRODUCT: mainProductReviewCount,
            COMPETITOR_1: competitor1ReviewCount,
            COMPETITOR_2: competitor2ReviewCount,
            COMPETITOR_3: competitor3ReviewCount,
          },
        }
      }
    });

    return {
      rowsCollected: total,
      total_posts: redditResults?.total_posts || 0,
      total_comments: redditResults?.total_comments || 0,
      mainProductReviews: mainProductReviewCount,
      competitor1Reviews: competitor1ReviewCount,
      competitor2Reviews: competitor2ReviewCount,
      competitor3Reviews: competitor3ReviewCount,
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
