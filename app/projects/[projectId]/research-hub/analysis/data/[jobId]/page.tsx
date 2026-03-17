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
  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
          <p className="text-[10px] font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Synthesizing_Analysis...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8 space-y-6">
        <Link
          href={`/projects/${projectId}/research-hub`}
          className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
        >
          ← Back to Research Hub
        </Link>
        <div className="rounded-card border border-danger/20 bg-danger/5 p-6 space-y-2">
          <p className="text-[10px] font-mono text-danger uppercase tracking-widest font-bold">Analysis_Fault_Detected</p>
          <p className="text-sm text-muted leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel/50 backdrop-blur-md px-8 py-6">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-4">
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
            >
              ← Back to Research Hub
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold tracking-tight text-white">Synthesis Output</h1>
              <div className="status-chip success uppercase tracking-widest text-[9px]">
                {jobId.substring(0, 8)}
              </div>
            </div>
            <p className="text-xs text-muted font-mono uppercase tracking-widest opacity-60">
              Analysis Type: <span className="text-accent">Audience Analysis</span> 
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleViewInputs}
              className="btn btn-secondary !min-h-[40px] px-6 text-[10px] font-bold uppercase tracking-widest"
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
              className="btn btn-primary !min-h-[40px] px-6 text-[10px] font-bold uppercase tracking-widest"
            >
              Download JSON
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-10 space-y-10 max-w-[1400px]">
        {showInputs && (
          <section className="rounded-card border border-line bg-panel overflow-hidden shadow-panel backdrop-blur-panel">
            <div className="border-b border-line bg-bg-elevated/50 px-6 py-3 flex items-center justify-between">
              <h2 className="text-[10px] font-mono text-accent uppercase tracking-[0.2em] font-bold">Input Parameters</h2>
              <div className="text-[9px] font-mono text-muted uppercase opacity-40">Request Data</div>
            </div>
            <div className="p-6 bg-bg/40">
              {inputsLoading && (
                <div className="flex items-center gap-3 py-4">
                  <div className="w-4 h-4 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
                  <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading inputs...</p>
                </div>
              )}
              {!inputsLoading && inputsError && (
                <div className="rounded border border-danger/20 bg-danger/5 p-4 text-[10px] font-mono text-danger uppercase">
                  {inputsError}
                </div>
              )}
              {!inputsLoading && !inputsError && analysisInputs && (
                <pre className="max-h-[32rem] overflow-auto text-[11px] font-mono text-muted/80 leading-relaxed whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-line">
                  {JSON.stringify(analysisInputs, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}

        {payload?.persona && (
          <section className="rounded-card border border-line bg-panel overflow-hidden shadow-panel">
            <div className="border-b border-line bg-bg-elevated/50 px-6 py-3 flex items-center justify-between">
              <h2 className="text-[10px] font-mono text-white uppercase tracking-[0.2em] font-bold">Synthesis_Output_Stream</h2>
              <div className="text-[9px] font-mono text-muted uppercase opacity-40">Extracted_Persona_Profile</div>
            </div>
            <div className="p-6 bg-bg/20">
              <pre className="text-[12px] font-mono text-white/90 leading-relaxed whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-line">
                {JSON.stringify(payload.persona, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
