"use client";

import { useEffect, useMemo, useState } from "react";

type PhaseStatus = "completed" | "pending" | "running" | "needs_attention" | "failed";

type Phase = {
  key: string;
  label: string;
  status: PhaseStatus;
  lastJob?: {
    id: string;
    type: string;
    status: string;
    updatedAt: string;
    resultSummary?: string | null;
    error?: string | null;
  } | null;
};

type PipelinePhase = {
  key: string;
  label: string;
  description: string;
};

const pipelinePhases: PipelinePhase[] = [
  {
    key: "research",
    label: "1 · Research",
    description: "Capture Reddit + review insights",
  },
  {
    key: "avatar_product_intel",
    label: "2 · Avatar & Product Intel",
    description: "Run Phase 1B analysis",
  },
  {
    key: "pattern_brain",
    label: "3 · Pattern Brain",
    description: "Ad pattern + performance",
  },
  {
    key: "script_characters",
    label: "4 · Script & Characters",
    description: "Script + persona generation",
  },
  {
    key: "storyboards_frames",
    label: "5 · Storyboards",
    description: "Storyboard + scene planning",
  },
  {
    key: "scenes_review",
    label: "6 · Scenes & Review",
    description: "Images, prompts, and QC",
  },
  {
    key: "upscale_export",
    label: "7 · Upscale & Export",
    description: "Finalize high-res delivery",
  },
];

function statusBadge(status: PhaseStatus) {
  const normalized = status === "failed" ? "needs_attention" : status;
  const colorMap: Record<typeof normalized, string> = {
    pending: "bg-slate-800/80 text-slate-300 border border-slate-700",
    running: "bg-sky-500/10 text-sky-300 border border-sky-500/50",
    needs_attention: "bg-red-500/10 text-red-300 border border-red-500/50",
    completed: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/50",
  };
  const labelMap: Record<typeof normalized, string> = {
    pending: "Pending",
    running: "Running",
    needs_attention: "Needs Attention",
    completed: "Completed",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${colorMap[normalized]}`}>
      {labelMap[normalized]}
    </span>
  );
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Props = {
  projectId: string;
};

export function PipelineStatusDb({ projectId }: Props) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const url = useMemo(() => `/api/projects/${encodeURIComponent(projectId)}/pipeline-status`, [projectId]);

  const phaseByKey = useMemo(() => {
    const map = new Map<string, Phase>();
    for (const phase of phases) {
      if (phase?.key) map.set(phase.key, phase);
    }
    return map;
  }, [phases]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const ct = r.headers.get("content-type") || "";
        const t = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        if (!ct.includes("application/json")) {
          throw new Error(`Expected JSON, got ${ct || "unknown"}: ${t.slice(0, 200)}`);
        }
        const j = JSON.parse(t);
        if (!j?.ok) throw new Error(j?.error || "Unknown error");
        if (!cancelled) {
          setPhases(j.phases || []);
          setErr(null);
        }
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Pipeline Status</h2>
        <span className="text-[11px] text-slate-500">Phases auto-update from job history</span>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {pipelinePhases.map((phase) => {
          const apiPhase = phaseByKey.get(phase.key);
          const status = apiPhase?.status ?? "pending";
          const supportingJob = apiPhase?.lastJob ?? null;
          const updatedAt = supportingJob?.updatedAt
            ? dateFormatter.format(new Date(supportingJob.updatedAt))
            : null;

          return (
            <div
              key={phase.key}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-50">{phase.label}</p>
                {statusBadge(status)}
              </div>
              <p className="text-xs text-slate-400">{phase.description}</p>
              {supportingJob && updatedAt && (
                <p className="text-[11px] text-slate-500">
                  Last job: {supportingJob.type.replace(/_/g, " ")} {"\u00b7"} {updatedAt}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
