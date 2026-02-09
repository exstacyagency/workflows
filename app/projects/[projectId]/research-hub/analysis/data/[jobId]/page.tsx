'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function CustomerAnalysisDataPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<any>(null);
  const [showInputs, setShowInputs] = useState(false);
  const [inputsLoading, setInputsLoading] = useState(false);
  const [inputsError, setInputsError] = useState<string | null>(null);
  const [analysisInputs, setAnalysisInputs] = useState<any>(null);

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

  async function handleViewInputs() {
    if (showInputs) {
      setShowInputs(false);
      return;
    }

    setShowInputs(true);
    if (analysisInputs || inputsLoading) return;

    try {
      setInputsLoading(true);
      setInputsError(null);
      const res = await fetch(`/api/projects/${projectId}/customer-analysis/${jobId}?includeInputs=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load analysis input parameters');
      }
      const data = await res.json();
      setAnalysisInputs(data.analysisInputs ?? null);
    } catch (err: any) {
      setInputsError(err.message || 'Failed to load analysis input parameters');
    } finally {
      setInputsLoading(false);
    }
  }

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
            <div className="flex items-center gap-2">
              <button
                onClick={handleViewInputs}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium"
              >
                {showInputs ? 'Hide Input Parameters' : 'View Input Parameters'}
              </button>
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
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-6">
        {showInputs && (
          <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Customer Analysis Input Parameters
            </h2>
            {inputsLoading && (
              <div className="text-sm text-slate-400">Loading input parameters...</div>
            )}
            {!inputsLoading && inputsError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {inputsError}
              </div>
            )}
            {!inputsLoading && !inputsError && analysisInputs && (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-200">
                {JSON.stringify(analysisInputs, null, 2)}
              </pre>
            )}
          </div>
        )}

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
