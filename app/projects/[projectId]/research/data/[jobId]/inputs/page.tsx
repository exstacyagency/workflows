'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Job = {
  id: string;
  type: string;
  status: string;
  payload?: any;
  resultSummary?: any;
  createdAt: string;
  updatedAt: string;
  runId?: string | null;
};

type ResearchRow = {
  id: string;
  source: string;
  metadata: any;
  createdAt: string;
};

type QueryInputRecord = {
  problem: string;
  query_type: string;
  query_used: string;
  subreddit: string;
  source: string;
};

const AMAZON_ACTOR_ID = 'ZebkvH3nVOrafqr5T';

const AMAZON_BASE_INPUT = {
  domainCode: 'com',
  sortBy: 'recent',
  maxPages: 1,
  filterByKeyword: '',
  reviewerType: 'all_reviews',
  formatType: 'current_format',
  mediaType: 'all_contents',
};

function toTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function buildAmazonInputs(payload: any) {
  const productAsin = toTrimmed(payload?.mainProductAsin || payload?.productAmazonAsin);
  const competitor1Asin = toTrimmed(payload?.competitor1Asin || payload?.competitor1AmazonAsin);
  const competitor2Asin = toTrimmed(payload?.competitor2Asin || payload?.competitor2AmazonAsin);
  const competitor3Asin = toTrimmed(payload?.competitor3Asin);

  const requests: Array<{ label: string; input: any }> = [];

  if (productAsin) {
    requests.push({
      label: 'Product ASIN (4-star)',
      input: { asin: productAsin, ...AMAZON_BASE_INPUT, filterByStar: 'four_star' },
    });
    requests.push({
      label: 'Product ASIN (5-star)',
      input: { asin: productAsin, ...AMAZON_BASE_INPUT, filterByStar: 'five_star' },
    });
  }

  if (competitor1Asin) {
    requests.push({
      label: 'Competitor 1 ASIN (4-star)',
      input: { asin: competitor1Asin, ...AMAZON_BASE_INPUT, filterByStar: 'four_star' },
    });
    requests.push({
      label: 'Competitor 1 ASIN (5-star)',
      input: { asin: competitor1Asin, ...AMAZON_BASE_INPUT, filterByStar: 'five_star' },
    });
  }

  if (competitor2Asin) {
    requests.push({
      label: 'Competitor 2 ASIN (4-star)',
      input: { asin: competitor2Asin, ...AMAZON_BASE_INPUT, filterByStar: 'four_star' },
    });
    requests.push({
      label: 'Competitor 2 ASIN (5-star)',
      input: { asin: competitor2Asin, ...AMAZON_BASE_INPUT, filterByStar: 'five_star' },
    });
  }

  if (competitor3Asin) {
    requests.push({
      label: 'Competitor 3 ASIN (4-star)',
      input: { asin: competitor3Asin, ...AMAZON_BASE_INPUT, filterByStar: 'four_star' },
    });
    requests.push({
      label: 'Competitor 3 ASIN (5-star)',
      input: { asin: competitor3Asin, ...AMAZON_BASE_INPUT, filterByStar: 'five_star' },
    });
  }

  return {
    actorId: AMAZON_ACTOR_ID,
    requests,
  };
}

function buildRedditInputs(payload: any) {
  const productProblemSolved = toTrimmed(payload?.productProblemSolved);
  if (!productProblemSolved) return null;

  return {
    discoveryStage: {
      endpoint: '/scrape',
      method: 'POST',
      body: {
        query: productProblemSolved,
        search_type: 'sitewide',
        max_posts: 200,
        time_range: 'month',
        scrape_comments: false,
      },
      notes: 'Stage 1 discovers relevant subreddits by problem.',
    },
    deepSearchStage: {
      endpoint: '/scrape',
      method: 'POST',
      bodyTemplate: {
        query: '<derived from problem + solutionKeywords/searchIntent/redditKeywords>',
        search_type: '<subreddit or sitewide>',
        subreddit: '<discovered subreddit>',
        max_posts: Math.max(1, Math.ceil(((payload?.maxPosts ?? 50) * 2) / 10)),
        time_range: payload?.timeRange ?? 'month',
        scrape_comments:
          typeof payload?.scrapeComments === 'boolean' ? payload.scrapeComments : true,
        max_comments_per_post: payload?.maxCommentsPerPost ?? 50,
      },
      queryPriority: [
        'solutionKeywords',
        'searchIntent',
        'redditKeywords',
        'problem only',
      ],
      notes: 'Stage 2 runs per discovered subreddit and rotates query intent.',
    },
    operatorInputs: {
      productProblemSolved,
      mainProductAsin: payload?.mainProductAsin ?? payload?.productAmazonAsin,
      competitor1Asin: payload?.competitor1Asin ?? payload?.competitor1AmazonAsin,
      competitor2Asin: payload?.competitor2Asin ?? payload?.competitor2AmazonAsin,
      competitor3Asin: payload?.competitor3Asin,
      additionalProblems: asStringArray(payload?.additionalProblems),
      solutionKeywords: asStringArray(payload?.solutionKeywords),
      searchIntent: asStringArray(payload?.searchIntent),
      redditKeywords: asStringArray(payload?.redditKeywords),
      maxPosts: payload?.maxPosts ?? 50,
      maxCommentsPerPost: payload?.maxCommentsPerPost ?? 50,
      timeRange: payload?.timeRange ?? 'month',
      scrapeComments:
        typeof payload?.scrapeComments === 'boolean' ? payload.scrapeComments : true,
    },
  };
}

export default function InputParametersPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;
  const runId = searchParams.get('runId');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [rows, setRows] = useState<ResearchRow[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [jobsRes, rowsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/jobs`),
          fetch(`/api/projects/${projectId}/research?jobId=${jobId}&limit=500&offset=0`),
        ]);

        const jobsData = await jobsRes.json();
        const rowsData = await rowsRes.json();

        if (!jobsRes.ok || !jobsData?.success) {
          throw new Error(jobsData?.error || 'Failed to load job payload');
        }
        if (!rowsRes.ok) {
          throw new Error(rowsData?.error || 'Failed to load research rows');
        }

        const foundJob = (Array.isArray(jobsData.jobs) ? jobsData.jobs : []).find(
          (item: Job) => item.id === jobId
        );
        if (!foundJob) {
          throw new Error('Job not found');
        }

        if (!mounted) return;
        setJob(foundJob);
        setRows(Array.isArray(rowsData.rows) ? rowsData.rows : []);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || 'Failed to load input parameters');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [jobId, projectId]);

  const payload = useMemo(() => job?.payload ?? {}, [job?.payload]);
  const redditInputs = useMemo(() => buildRedditInputs(payload), [payload]);
  const amazonInputs = useMemo(() => buildAmazonInputs(payload), [payload]);

  const observedQueries = useMemo<QueryInputRecord[]>(() => {
    const seen = new Set<string>();
    const list: QueryInputRecord[] = [];

    for (const row of rows) {
      if (row.source !== 'REDDIT_PRODUCT' && row.source !== 'REDDIT_PROBLEM') continue;
      const metadata = row.metadata ?? {};
      const query_used = String(metadata?.query_used ?? '').trim();
      const problem = String(metadata?.search_problem ?? '').trim();
      const query_type = String(metadata?.query_type ?? 'problem').trim();
      const subreddit = String(metadata?.subreddit ?? 'sitewide').trim() || 'sitewide';
      if (!query_used) continue;

      const key = `${query_used}|${problem}|${query_type}|${subreddit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        problem: problem || '(unknown)',
        query_type,
        query_used,
        subreddit,
        source: row.source,
      });
    }

    return list.sort((a, b) => a.query_used.localeCompare(b.query_used));
  }, [rows]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 px-6 py-6">
        <p className="text-sm text-slate-400">Loading input parameters...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 px-6 py-6">
        <Link
          href={`/projects/${projectId}/research/data/${jobId}${runId ? `?runId=${runId}` : ''}`}
          className="text-sm text-sky-400 hover:text-sky-300"
        >
          ← Back to Raw Research Data
        </Link>
        <p className="mt-4 text-sm text-red-400">{error || 'Unable to load job details'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
        <Link
          href={`/projects/${projectId}/research/data/${jobId}${runId ? `?runId=${runId}` : ''}`}
          className="text-sm text-sky-400 hover:text-sky-300 inline-block mb-2"
        >
          ← Back to Raw Research Data
        </Link>
        <h1 className="text-2xl font-bold">Input Parameters</h1>
        <p className="text-sm text-slate-400 mt-1">
          Job {job.id.substring(0, 8)} · {job.type} · {job.status}
        </p>
      </div>

      <div className="px-6 py-6 space-y-6">
        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Job Payload</h2>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </section>

        {redditInputs && (
          <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="text-lg font-semibold text-white mb-3">Reddit Scraper Inputs</h2>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
              {JSON.stringify(redditInputs, null, 2)}
            </pre>
          </section>
        )}

        {amazonInputs.requests.length > 0 && (
          <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="text-lg font-semibold text-white mb-3">Amazon Scraper Inputs</h2>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
              {JSON.stringify(amazonInputs, null, 2)}
            </pre>
          </section>
        )}

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Observed Reddit Queries</h2>
          {observedQueries.length === 0 ? (
            <p className="text-sm text-slate-400">No query metadata found in loaded rows.</p>
          ) : (
            <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
              {JSON.stringify(observedQueries, null, 2)}
            </pre>
          )}
          <p className="text-xs text-slate-500 mt-2">
            Query metadata is derived from stored row metadata (`query_type`, `query_used`,
            `search_problem`, `subreddit`).
          </p>
        </section>
      </div>
    </div>
  );
}
