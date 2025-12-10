import { prisma } from '@/lib/prisma';
import { JobStatus, ResearchSource } from '@prisma/client';

export type RunCustomerResearchParams = {
  projectId: string;
  jobId: string;
  productName: string;
  productProblemSolved: string;
  productAmazonAsin: string;
  competitor1AmazonAsin?: string;
  competitor2AmazonAsin?: string;
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
};

type AmazonReview = {
  reviewText?: string;
  text?: string;
  rating?: number;
  verified?: boolean;
  date?: string;
};

type ResearchRowInput = Parameters<(typeof prisma.researchRow)['createMany']>[0]['data'][number];

const APIFY_BASE = 'https://api.apify.com/v2';
const FETCH_RETRY_ATTEMPTS = Number(process.env.CUSTOMER_RESEARCH_FETCH_RETRIES ?? 3);
const REDDIT_PAGE_SIZE = Number(process.env.CUSTOMER_RESEARCH_REDDIT_PAGE_SIZE ?? 75);
const REDDIT_MAX_PAGES = Number(process.env.CUSTOMER_RESEARCH_REDDIT_PAGES ?? 3);
const MIN_RESEARCH_ROWS = Number(process.env.CUSTOMER_RESEARCH_MIN_ROWS ?? 25);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit | undefined, label: string) {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${label} failed (${res.status}): ${text}`);
      }
      return res;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === FETCH_RETRY_ATTEMPTS) {
        break;
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 5000);
      await sleep(backoff);
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}

async function runApifyActor<T>(actorId: string, input: Record<string, unknown>) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error('APIFY_TOKEN is not set');
  }

  const runResponse = await fetchWithRetry(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=120`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    },
    `Apify actor ${actorId}`
  );

  const runData = await runResponse.json();
  const datasetId: string | undefined = runData?.data?.defaultDatasetId;
  if (!datasetId) {
    throw new Error('Apify run did not return a datasetId');
  }

  const datasetRes = await fetchWithRetry(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&token=${token}`,
    undefined,
    `Apify dataset ${datasetId}`
  );

  return (await datasetRes.json()) as T[];
}

async function searchReddit(keyword: string) {
  if (!keyword) return [] as RedditPost[];

  const collected: RedditPost[] = [];
  let after: string | undefined;
  const headers = { 'User-Agent': process.env.REDDIT_USER_AGENT || 'ai-ad-lab/1.0' };

  for (let page = 0; page < REDDIT_MAX_PAGES; page++) {
    const searchUrl = new URL('https://www.reddit.com/search.json');
    searchUrl.searchParams.set('q', keyword);
    searchUrl.searchParams.set('limit', `${REDDIT_PAGE_SIZE}`);
    searchUrl.searchParams.set('sort', 'top');
    if (after) {
      searchUrl.searchParams.set('after', after);
    }

    const res = await fetchWithRetry(searchUrl.toString(), { headers }, 'Reddit search');
    const data = await res.json();
    const children = data?.data?.children || [];
    if (!children.length) {
      break;
    }
    collected.push(...(children.map((item: any) => item?.data) as RedditPost[]));
    after = data?.data?.after;
    if (!after) {
      break;
    }
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
  const brand = lowerProduct.split(' ')[0];

  return items.filter((i) => {
    const text = (i.body || i.selftext || '').toLowerCase();
    const author = (i.author || '').toLowerCase();
    const mentions = text.includes(lowerProduct) || text.includes(brand);
    const isBrandAccount = author.includes(brand);
    return mentions && !isBrandAccount;
  });
}

function filterProblemComments(items: RedditPost[]) {
  const postMap = new Map<string, { post: RedditPost | null; comments: RedditPost[] }>();

  items.forEach((item) => {
    const d = item;
    if (d.kind === 'post') {
      if (!postMap.has(d.id || '')) {
        postMap.set(d.id || '', { post: d, comments: [] });
      }
    } else if (d.kind === 'comment') {
      const key = d.postId || d.id || '';
      if (!postMap.has(key)) {
        postMap.set(key, { post: null, comments: [] });
      }
      postMap.get(key)?.comments.push(d);
    }
  });

  return Array.from(postMap.values())
    .filter((p) => p.post && p.comments.length > 0)
    .map((p) => {
      const painComments = p.comments.filter((c) => {
        const text = (c.body || '').toLowerCase();
        const wordCount = text.split(' ').length;
        if (wordCount < 30) return false;
        return /tried everything|years|months|nothing work|desperate|given up|can't take|tired of|frustrated|help|struggle|worse|failed|stopped working/i.test(
          text
        );
      });

      return {
        post: p.post,
        comments: painComments.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20),
        commentCount: painComments.length
      };
    })
    .filter((p) => p.comments.length > 0);
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

async function fetchApifyAmazonReviews(asin: string, starFilter: 'five_star' | 'four_star' | 'one_star', maxPages = 10) {
  if (!asin) return [] as AmazonReview[];
  const input = { input: [{ asin, domainCode: 'com', sortBy: 'helpful', maxPages, filterByStar: starFilter }] };
  return runApifyActor<AmazonReview>('ZebkvH3nVOrafqr5T', input);
}

async function fetchApifyRedditByUrls(urls: string[]) {
  if (urls.length === 0) return [] as RedditPost[];
  const input = { includeNsfw: false, scrapeComments: true, urls: urls.slice(0, 20) };
  return runApifyActor<RedditPost>('TwqHBuZZPHJxiQrTU', input);
}

function dedupeRows(rows: ResearchRowInput[]) {
  const seen = new Set<string>();
  const normalizedRows: typeof rows = [];

  for (const row of rows) {
    const normalizedContent = row.content.replace(/\s+/g, ' ').trim();
    if (!normalizedContent) continue;
    const dedupeKey = `${row.source}:${normalizedContent.toLowerCase()}:${row.sourceUrl ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedRows.push({ ...row, content: normalizedContent });
  }

  return normalizedRows;
}

export async function runCustomerResearch(params: RunCustomerResearchParams) {
  const { projectId, jobId, productName, productProblemSolved, productAmazonAsin, competitor1AmazonAsin, competitor2AmazonAsin } =
    params;

  await prisma.job.update({ where: { id: jobId }, data: { status: JobStatus.RUNNING } });

  try {
    if (!productName || !productProblemSolved || !productAmazonAsin) {
      throw new Error('productName, productProblemSolved, and productAmazonAsin are required for customer research.');
    }

    // 1) Reddit posts by product name and problem statement
    const [productPosts, problemPosts] = await Promise.all([
      searchReddit(productName),
      searchReddit(productProblemSolved)
    ]);

    const productUrls = extractUrlsFromPosts(productPosts);
    const problemUrls = extractUrlsFromPosts(problemPosts);

    const [productDetails, problemDetails] = await Promise.all([
      fetchApifyRedditByUrls(productUrls),
      fetchApifyRedditByUrls(problemUrls)
    ]);

    const filteredProductComments = filterProductComments(productDetails, productName);
    const filteredProblemComments = filterProblemComments(problemDetails);

    // 2) Amazon reviews for product and competitors
    const [product5Star, product4Star, competitor1, competitor2] = await Promise.all([
      fetchApifyAmazonReviews(productAmazonAsin, 'five_star', 10),
      fetchApifyAmazonReviews(productAmazonAsin, 'four_star', 15),
      competitor1AmazonAsin ? fetchApifyAmazonReviews(competitor1AmazonAsin, 'one_star', 10) : Promise.resolve([]),
      competitor2AmazonAsin ? fetchApifyAmazonReviews(competitor2AmazonAsin, 'one_star', 10) : Promise.resolve([])
    ]);

    const processed5Star = processReviews(product5Star, 4);
    const processed4Star = processReviews(product4Star, 4);
    const processedCompetitor1 = processReviews(competitor1, 2);
    const processedCompetitor2 = processReviews(competitor2, 2);

    // 3) Build ResearchRow payloads
    const rows: ResearchRowInput[] = [
      ...filteredProductComments.map((item, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.REDDIT_PRODUCT,
        indexLabel: `${idx + 1}`,
        content: item.body || item.selftext || '',
        metadata: {
          author: item.author,
          subreddit: item.subreddit,
          score: item.score,
          url: item.url || item.permalink
        },
        sourceUrl: item.url || item.permalink
      })),
      ...filteredProblemComments.flatMap((item, idx) =>
        item.comments.map((comment, cidx) => ({
          projectId,
          jobId,
          source: ResearchSource.REDDIT_PROBLEM,
          indexLabel: `${idx + 1}.${cidx + 1}`,
          content: comment.body || '',
          metadata: {
            postTitle: item.post?.title,
            score: comment.score
          },
          sourceUrl: comment.permalink || item.post?.permalink
        }))
      ),
      ...processed5Star.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON_PRODUCT_5_STAR,
        indexLabel: `${idx + 1}`,
        content: r.text,
        rating: r.rating,
        cinematicScore: r.cinematicScore,
        verified: r.verified,
        metadata: {
          date: r.date,
          wordCount: r.wordCount
        }
      })),
      ...processed4Star.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON_PRODUCT_4_STAR,
        indexLabel: `${idx + 1}`,
        content: r.text,
        rating: r.rating,
        cinematicScore: r.cinematicScore,
        verified: r.verified,
        metadata: {
          date: r.date,
          wordCount: r.wordCount
        }
      })),
      ...processedCompetitor1.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON_COMPETITOR_1,
        indexLabel: `${idx + 1}`,
        content: r.text,
        rating: r.rating,
        cinematicScore: r.cinematicScore,
        verified: r.verified,
        metadata: {
          date: r.date,
          wordCount: r.wordCount
        }
      })),
      ...processedCompetitor2.map((r, idx) => ({
        projectId,
        jobId,
        source: ResearchSource.AMAZON_COMPETITOR_2,
        indexLabel: `${idx + 1}`,
        content: r.text,
        rating: r.rating,
        cinematicScore: r.cinematicScore,
        verified: r.verified,
        metadata: {
          date: r.date,
          wordCount: r.wordCount
        }
      }))
    ];

    const dedupedRows = dedupeRows(rows);

    const storedRows = await prisma.$transaction(async (tx) => {
      if (dedupedRows.length > 0) {
        await tx.researchRow.createMany({ data: dedupedRows });
      }
      return tx.researchRow.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
    });

    if (dedupedRows.length < MIN_RESEARCH_ROWS) {
      throw new Error(
        `Only ${dedupedRows.length} research rows collected (minimum required: ${MIN_RESEARCH_ROWS}). Provide broader keywords or ASINs and try again.`
      );
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Captured ${dedupedRows.length} research rows from Reddit and Amazon after deduplication.`
      }
    });

    return storedRows;
  } catch (error) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    throw error;
  }
}
