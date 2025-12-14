import { prisma } from '@/lib/prisma';
import { JobStatus, ResearchSource } from '@prisma/client';

// ============================================================================
// Type Definitions
// ============================================================================

export type IdentifierType = 'amazon_asin' | 'g2_url' | 'local_business' | 'none';

export type Phase1AInput = {
  projectId: string;
  jobId: string;
  offeringName: string;
  valueProp: string;
  identifierType: IdentifierType;
  identifier?: string;
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

type GenericReview = {
  text?: string;
  reviewText?: string;
  rating?: number;
  verified?: boolean;
  date?: string;
  author?: string;
};

type ArrayElement<T> = T extends (infer U)[] ? U : T;
type ResearchRowInput = ArrayElement<
  NonNullable<Parameters<(typeof prisma.researchRow)['createMany']>[0]>['data']
>;
type ResearchRowPayload = Omit<ResearchRowInput, 'projectId' | 'jobId'>;

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

// ============================================================================
// Reddit Scraper
// ============================================================================

class RedditScraper {
  async scrape(input: Phase1AInput) {
    const { offeringName, valueProp } = input;

    // Search Reddit for product and problem mentions
    const [productPosts, problemPosts] = await Promise.all([
      this.searchReddit(offeringName),
      this.searchReddit(valueProp)
    ]);

    const productUrls = this.extractUrls(productPosts);
    const problemUrls = this.extractUrls(problemPosts);

    // Fetch detailed comments
    const [productDetails, problemDetails] = await Promise.all([
      this.fetchRedditByUrls(productUrls),
      this.fetchRedditByUrls(problemUrls)
    ]);

    // Filter and format
    const productComments = this.filterProductComments(productDetails, offeringName);
    const problemComments = this.filterProblemComments(problemDetails);

    return {
      productRows: productComments.map((item, idx) => ({
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
      problemRows: problemComments.flatMap((item, idx) =>
        item.comments.map((comment, cidx) => ({
          source: ResearchSource.REDDIT_PROBLEM,
          indexLabel: `${idx + 1}.${cidx + 1}`,
          content: comment.body || '',
          metadata: {
            postTitle: item.post?.title,
            score: comment.score
          },
          sourceUrl: comment.permalink || item.post?.permalink
        }))
      )
    };
  }

  private async searchReddit(keyword: string) {
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
      if (!children.length) break;
      collected.push(...(children.map((item: any) => item?.data) as RedditPost[]));
      after = data?.data?.after;
      if (!after) break;
      await sleep(300);
    }

    return collected;
  }

  private extractUrls(posts: RedditPost[]) {
    return posts
      .map((p) => p.url || (p.permalink ? `https://reddit.com${p.permalink}` : null))
      .filter(Boolean) as string[];
  }

  private async fetchRedditByUrls(urls: string[]) {
    if (urls.length === 0) return [] as RedditPost[];
    const input = { includeNsfw: false, scrapeComments: true, urls: urls.slice(0, 20) };
    return runApifyActor<RedditPost>('TwqHBuZZPHJxiQrTU', input);
  }

  private filterProductComments(items: RedditPost[], productName: string) {
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

  private filterProblemComments(items: RedditPost[]) {
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
          comments: painComments.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20)
        };
      })
      .filter((p) => p.comments.length > 0);
  }
}

// ============================================================================
// Amazon Scraper
// ============================================================================

class AmazonScraper {
  async scrape(input: Phase1AInput) {
    const { identifier } = input;
    if (!identifier) throw new Error('Amazon ASIN is required');

    const input_data = { input: [{ asin: identifier, domainCode: 'com', sortBy: 'helpful', maxPages: 20 }] };
    const reviews = await runApifyActor<GenericReview>('ZebkvH3nVOrafqr5T', input_data);

    return reviews
      .filter((r) => r.reviewText || r.text)
      .map((r, idx) => ({
        source: ResearchSource.AMAZON,
        indexLabel: `${idx + 1}`,
        content: (r.reviewText || r.text || '').trim(),
        rating: r.rating,
        verified: r.verified,
        metadata: { date: r.date }
      }));
  }
}

// ============================================================================
// Yelp Scraper
// ============================================================================

class YelpScraper {
  async scrape(input: Phase1AInput) {
    const { identifier } = input;
    if (!identifier) throw new Error('Business name is required');

    // Search by business name (identifier format: "Business Name, City, State")
    const input_data = {
      searchTerms: identifier,
      maxReviews: 100,
      reviewsSort: 'Best Match'
    };
    const reviews = await runApifyActor<GenericReview>('qDT2tDKmBATJGHmX', input_data);

    return reviews
      .filter((r) => r.text || r.reviewText)
      .map((r, idx) => ({
        source: ResearchSource.LOCAL_BUSINESS,
        indexLabel: `yelp-${idx + 1}`,
        content: (r.text || r.reviewText || '').trim(),
        rating: r.rating,
        verified: r.verified,
        metadata: { date: r.date, author: r.author, platform: 'yelp' }
      }));
  }
}

// ============================================================================
// Google Business Scraper
// ============================================================================

class GoogleBusinessScraper {
  async scrape(input: Phase1AInput) {
    const { identifier } = input;
    if (!identifier) throw new Error('Business name is required');

    // Search by business name (identifier format: "Business Name, City, State")
    const input_data = {
      searchStringsArray: [identifier],
      maxReviews: 100,
      reviewsSort: 'newest'
    };
    const reviews = await runApifyActor<GenericReview>('Xb8osYTtOjlsgI6k9', input_data);

    return reviews
      .filter((r) => r.text || r.reviewText)
      .map((r, idx) => ({
        source: ResearchSource.LOCAL_BUSINESS,
        indexLabel: `google-${idx + 1}`,
        content: (r.text || r.reviewText || '').trim(),
        rating: r.rating,
        verified: r.verified,
        metadata: { date: r.date, author: r.author, platform: 'google' }
      }));
  }
}

// ============================================================================
// G2 Scraper
// ============================================================================

class G2Scraper {
  async scrape(input: Phase1AInput) {
    const { identifier } = input;
    if (!identifier) throw new Error('G2 URL is required');

    const input_data = {
      startUrls: [identifier],
      maxReviews: 100
    };
    const reviews = await runApifyActor<GenericReview>('ajqs7IrvvxeteDYPv', input_data);

    return reviews
      .filter((r) => r.text || r.reviewText)
      .map((r, idx) => ({
        source: ResearchSource.G2,
        indexLabel: `${idx + 1}`,
        content: (r.text || r.reviewText || '').trim(),
        rating: r.rating,
        verified: r.verified,
        metadata: { date: r.date, author: r.author }
      }));
  }
}

function dedupeRows(rows: ResearchRowInput[]) {
  const seen = new Set<string>();
  const normalized: ResearchRowInput[] = [];

  for (const row of rows) {
    const normalizedContent = row.content?.replace(/\s+/g, ' ').trim();
    if (!normalizedContent) continue;
    const key = `${row.projectId}:${row.source}:${normalizedContent.toLowerCase()}:${row.sourceUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...row, content: normalizedContent });
  }

  return normalized;
}

// ============================================================================
// Main Orchestration
// ============================================================================

export async function runPhase1A(input: Phase1AInput) {
  const { projectId, jobId, identifierType } = input;

  await prisma.job.update({ where: { id: jobId }, data: { status: JobStatus.RUNNING } });

  try {
    // Build scraper array
    const scrapers: any[] = [];

    // Always add Reddit
    scrapers.push({ name: 'reddit', scraper: new RedditScraper() });

    // Add review platform scrapers based on identifier type
    if (identifierType === 'amazon_asin') {
      scrapers.push({ name: 'amazon', scraper: new AmazonScraper() });
    } else if (identifierType === 'g2_url') {
      scrapers.push({ name: 'g2', scraper: new G2Scraper() });
    } else if (identifierType === 'local_business') {
      // Both scrapers search by business name - symmetric coverage
      scrapers.push({ name: 'google', scraper: new GoogleBusinessScraper() });
      scrapers.push({ name: 'yelp', scraper: new YelpScraper() });
    }

    // Execute all scrapers with graceful error handling
    const results = await Promise.allSettled(
      scrapers.map(({ name, scraper }) =>
        scraper.scrape(input).catch((err: Error) => {
          console.error(`Scraper ${name} failed:`, err.message);
          return null;
        })
      )
    );

    const successfulScrapers: string[] = [];
    const payloads: ResearchRowPayload[] = [];

    results.forEach((result, idx) => {
      const scraperName = scrapers[idx].name;
      if (result.status === 'fulfilled' && result.value) {
        successfulScrapers.push(scraperName);
        const data = result.value;
        if (scraperName === 'reddit') {
          payloads.push(...data.productRows, ...data.problemRows);
        } else {
          payloads.push(...data);
        }
      }
    });

    const preparedRows: ResearchRowInput[] = payloads.map((row) => ({
      projectId,
      jobId,
      ...row
    }));

    const dedupedRows = dedupeRows(preparedRows);

    const storedRows = await prisma.$transaction(async (tx) => {
      if (dedupedRows.length > 0) {
        await tx.researchRow.createMany({ data: dedupedRows });
      }
      return tx.researchRow.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
    });

    if (dedupedRows.length < MIN_RESEARCH_ROWS) {
      throw new Error(
        `Only ${dedupedRows.length} research rows collected (minimum required: ${MIN_RESEARCH_ROWS}). Try broader keywords or different identifiers.`
      );
    }

    const summarySources = successfulScrapers.length ? successfulScrapers.join(', ') : 'no scrapers';

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Captured ${dedupedRows.length} research rows from ${summarySources} after deduplication.`
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
