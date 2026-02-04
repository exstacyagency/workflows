'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CustomerAnalysisDataPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<any>(null);

  useEffect(() => {
    async function loadAnalysis() {
      try {
        setLoading(true);
        const res = await fetch(`/api/projects/${projectId}/customer-analysis/${jobId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load analysis data');
        }
        const data = await res.json();
        setPayload(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load analysis data');
      } finally {
        setLoading(false);
      }
    }

    if (projectId && jobId) {
      loadAnalysis();
    }
  }, [projectId, jobId]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="text-sm text-sky-400 hover:text-sky-300 mb-2 inline-block"
            >
              ← Back to Research Hub
            </Link>
            <h1 className="text-2xl font-bold">Customer Analysis Output</h1>
            <p className="text-sm text-slate-400 mt-1">
              Job: {jobId.substring(0, 8)}
            </p>
          </div>
          {payload?.avatarId && (
            <button
              onClick={() => {
                const json = JSON.stringify(payload.persona ?? {}, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `customer-analysis-${jobId}.json`;
                a.click();
                window.URL.revokeObjectURL(url);
              }}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium"
            >
              Download JSON
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-6">
        {loading && (
          <div className="text-center py-12 text-slate-400">Loading analysis...</div>
        )}
        {!loading && error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && payload?.persona && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-slate-200">
              {JSON.stringify(payload.persona, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
