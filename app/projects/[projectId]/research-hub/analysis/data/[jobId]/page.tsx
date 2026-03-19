'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EmptyState, PageHeader, SectionCard, StatusChip } from '@/components/ui';

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

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
          <p className="text-label font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Synthesizing_Analysis...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8 space-y-6">
        <PageHeader backHref={`/projects/${projectId}/research-hub`} backLabel="Back to Research Hub" title="Analysis Output" />
        <EmptyState title="Analysis Error" description={error} variant="error" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel backdrop-blur-md px-8 py-6">
        <PageHeader
          backHref={`/projects/${projectId}/research-hub`}
          backLabel="Back to Research Hub"
          title="Synthesis Output"
          description="Analysis Type: Audience Analysis"
          actions={
            <>
              <StatusChip variant="success">{jobId.substring(0, 8)}</StatusChip>
            <button
              onClick={handleViewInputs}
              className="btn btn-secondary !min-h-[40px] px-6 text-label font-bold uppercase tracking-widest"
            >
              {showInputs ? 'Hide Inputs' : 'View Inputs'}
            </button>
            <button
              onClick={() => {
                const json = JSON.stringify(payload?.persona ?? {}, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `customer-analysis-${jobId}.json`;
                a.click();
                window.URL.revokeObjectURL(url);
              }}
              className="btn btn-primary !min-h-[40px] px-6 text-label font-bold uppercase tracking-widest"
            >
              Download JSON
            </button>
            </>
          }
        />
      </div>

      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        {showInputs && (
          <SectionCard padding="none" className="overflow-hidden">
            <div className="border-b border-line bg-bg-elevated px-6 py-3 flex items-center justify-between">
              <h2 className="text-label font-mono text-accent uppercase tracking-[0.2em] font-bold">Input Parameters</h2>
              <div className="text-label-sm font-mono text-muted uppercase opacity-40">Request Data</div>
            </div>
            <div className="p-6 bg-panel">
              {inputsLoading && (
                <div className="flex items-center gap-3 py-4">
                  <div className="w-4 h-4 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
                  <p className="text-label font-mono text-muted uppercase tracking-widest">Loading inputs...</p>
                </div>
              )}
              {!inputsLoading && inputsError && (
                <div className="rounded border border-danger/20 bg-danger/5 p-4 text-label font-mono text-danger uppercase">
                  {inputsError}
                </div>
              )}
              {!inputsLoading && !inputsError && analysisInputs && (
                <pre className="max-h-[32rem] overflow-auto text-body-sm font-mono text-muted leading-relaxed whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-line">
                  {JSON.stringify(analysisInputs, null, 2)}
                </pre>
              )}
            </div>
          </SectionCard>
        )}

        {payload?.persona && (
          <SectionCard padding="none" className="overflow-hidden">
            <div className="border-b border-line bg-bg-elevated px-6 py-3 flex items-center justify-between">
              <h2 className="text-label font-mono text-white uppercase tracking-[0.2em] font-bold">Analysis Output</h2>
              <div className="text-label-sm font-mono text-muted uppercase opacity-40">Persona Profile</div>
            </div>
            <div className="p-6 bg-transparent">
              <pre className="text-body-xs font-mono text-white leading-relaxed whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-line">
                {JSON.stringify(payload.persona, null, 2)}
              </pre>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
