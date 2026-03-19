"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard, StatusChip } from "@/components/ui";

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
  const labelMap: Record<typeof normalized, string> = {
    pending: "Pending",
    running: "Running",
    needs_attention: "Needs Attention",
    completed: "Completed",
  };
  const variantMap: Record<typeof normalized, "info" | "running" | "danger" | "success"> = {
    pending: "info",
    running: "running",
    needs_attention: "danger",
    completed: "success",
  };
  return (
    <StatusChip variant={variantMap[normalized]} className={normalized === "pending" ? "opacity-60" : ""}>
      {labelMap[normalized]}
    </StatusChip>
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
    <SectionCard className="space-y-3" padding="sm">
      <div className="flex items-center justify-between">
        <p className="eyebrow !mb-0">Pipeline Status</p>
        <span className="text-body-sm text-muted font-mono opacity-50">AUTO-UPDATE FROM JOB HISTORY</span>
      </div>
      {err && <p className="text-xs text-accent">{err}</p>}
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
              className="rounded-card border border-line bg-bg-elevated px-4 py-3 space-y-1.5 hover:bg-bg-elevated transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">{phase.label}</p>
                {statusBadge(status)}
              </div>
              <p className="text-xs text-muted">{phase.description}</p>
              {supportingJob && updatedAt && (
                <p className="text-body-sm text-muted font-mono opacity-50 uppercase">
                  Last: {supportingJob.type.replace(/_/g, " ")} {"\u00b7"} {updatedAt}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
