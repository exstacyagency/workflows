"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

type AssetRecord = {
  id: string;
  jobId: string | null;
  platform: string;
  isSwipeFile?: boolean;
  swipeMetadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  retention_3s?: number | null;
  retention_10s?: number | null;
  retention_3s_ctr?: number | null;
  retention_10s_ctr?: number | null;
  retention_3s_cvr?: number | null;
  retention_10s_cvr?: number | null;
  duration?: number | null;
  source_type?: string | null;
  engagement_score?: number | null;
  rawJson: Record<string, any> | null;
};

type JobRecord = {
  id: string;
  type: string;
  runId: string | null;
  createdAt: string;
  payload?: Record<string, any> | null;
};

function asObj(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function formatMetric(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
}

type OcrFrame = {
  second: number;
  text: string;
  textFound?: boolean;
  confidence: number | null;
  imageUrl: string | null;
};

type CsvValue = string | number | boolean | null | undefined;

function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, columns: string[], rows: Record<string, CsvValue>[]) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatSeconds(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return `${rounded}s`;
}

function formatConfidence(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return `${Math.round(value)}%`;
}

function parseOcrFrames(raw: Record<string, any>): OcrFrame[] {
  const source = Array.isArray(raw.ocrFrames) ? raw.ocrFrames : [];
  return source
    .map((item): OcrFrame | null => {
      const entry = asObj(item);
      const second = asNum(entry.second);
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      const confidence = asNum(entry.confidence);
      if (second === null) return null;
      return {
        second,
        text,
        textFound: typeof entry.textFound === "boolean" ? entry.textFound : text.length > 0,
        confidence: confidence === null ? null : confidence,
        imageUrl:
          typeof entry.imageUrl === "string" && entry.imageUrl.trim().length > 0
            ? entry.imageUrl.trim()
            : null,
      } satisfies OcrFrame;
    })
    .filter((v): v is OcrFrame => Boolean(v));
}

function parseSpikeSeconds(raw: Record<string, any>): number[] {
  const metrics = asObj(raw.metrics);
  const ocrMeta = asObj(metrics.ocr_meta);
  const spikes = Array.isArray(ocrMeta.highlightSeconds)
    ? ocrMeta.highlightSeconds
    : Array.isArray(metrics.conversion_spikes)
      ? metrics.conversion_spikes
      : [];
  return spikes
    .map((v) => asNum(v))
    .filter((v): v is number => typeof v === "number")
    .map((v) => Math.round(v));
}

export default function AdAssetsViewerPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = String(params?.projectId ?? "");
  const runId = String(params?.runId ?? "");
  const focus = String(searchParams?.get("focus") ?? "").trim();
  const highlightOcr = focus === "ocr";
  const pageTitle = highlightOcr ? "Ad OCR Output" : "Ad Collection Output";
  const researchHubBackHref = `/projects/${projectId}/research-hub${runId ? `?runId=${runId}` : ""}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [sourceJobPayload, setSourceJobPayload] = useState<Record<string, any> | null>(null);
  const [showInputs, setShowInputs] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [assetsRes, jobsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`),
          fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" }),
        ]);
        const assetsData = await assetsRes.json().catch(() => ({}));
        const jobsData = await jobsRes.json().catch(() => ({}));
        if (!assetsRes.ok || !assetsData?.success) {
          throw new Error(assetsData?.error || "Failed to load ad assets");
        }
        if (!jobsRes.ok || !jobsData?.success) {
          throw new Error(jobsData?.error || "Failed to load job inputs");
        }
        setAssets(Array.isArray(assetsData.assets) ? assetsData.assets : []);
        setSelectedAssetIds([]);

        const jobs = Array.isArray(jobsData.jobs) ? (jobsData.jobs as JobRecord[]) : [];
        const targetSubtype = highlightOcr ? "ad_ocr_collection" : "ad_raw_collection";
        const matchedJob =
          jobs
            .filter((job) => {
              const subtype = String(job.payload?.jobType ?? job.payload?.kind ?? "").trim();
              return job.type === "AD_PERFORMANCE" && job.runId === runId && subtype === targetSubtype;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
        setSourceJobPayload(matchedJob?.payload ?? null);
      } catch (e: any) {
        setError(e?.message || "Failed to load ad assets");
      } finally {
        setLoading(false);
      }
    }

    if (projectId && runId) {
      void load();
    }
  }, [highlightOcr, projectId, runId]);

  const rows = useMemo(
    () =>
      assets.map((asset) => {
        const raw = asObj(asset.rawJson);
        const metrics = asObj(raw.metrics);
        const videoUrl =
          (typeof raw.url === "string" && raw.url) ||
          (typeof raw.videoUrl === "string" && raw.videoUrl) ||
          "";
        return {
          asset,
          videoUrl,
          isSwipeFile: Boolean(asset.isSwipeFile),
          hasSwipeMetadata:
            asset.swipeMetadata &&
            typeof asset.swipeMetadata === "object" &&
            !Array.isArray(asset.swipeMetadata),
          swipeViews: asNum(metrics.views ?? metrics.view ?? metrics.plays ?? raw.views ?? raw.view ?? raw.plays),
          retention3s: metrics.retention_3s ?? asset.retention_3s,
          retention10s: metrics.retention_10s ?? asset.retention_10s,
          retention3sCtr: metrics.retention_3s_ctr ?? asset.retention_3s_ctr,
          retention10sCtr: metrics.retention_10s_ctr ?? asset.retention_10s_ctr,
          retention3sCvr: metrics.retention_3s_cvr ?? asset.retention_3s_cvr,
          retention10sCvr: metrics.retention_10s_cvr ?? asset.retention_10s_cvr,
          duration: metrics.duration ?? asset.duration,
          ctr: metrics.ctr,
          cost: metrics.cost,
          like: metrics.like ?? metrics.likes,
          sourceType: metrics.source_type ?? asset.source_type,
          engagementScore: metrics.engagement_score ?? asset.engagement_score,
          industryCode: metrics.industry_code,
          hasOcr:
            typeof raw.ocrText === "string" &&
            raw.ocrText.trim().length > 0,
          ocrFrames: parseOcrFrames(raw),
          spikeSeconds: parseSpikeSeconds(raw),
          raw,
        };
      }),
    [assets],
  );

  const exportRows = useMemo(
    () =>
      rows.map((row) => {
        const ocrText = typeof row.raw.ocrText === "string" ? row.raw.ocrText.trim() : "";
        const transcript = typeof row.raw.transcript === "string" ? row.raw.transcript.trim() : "";
        return {
          createdAt: row.asset.createdAt,
          updatedAt: row.asset.updatedAt,
          assetId: row.asset.id,
          jobId: row.asset.jobId ?? "",
          platform: row.asset.platform,
          isSwipeFile: row.isSwipeFile,
          swipeViews: row.swipeViews ?? "",
          swipeTemplateExtracted: row.hasSwipeMetadata,
          videoUrl: row.videoUrl,
          retention3s: row.retention3s ?? "",
          retention10s: row.retention10s ?? "",
          duration: row.duration ?? "",
          retention3sCtr: row.retention3sCtr ?? "",
          retention10sCtr: row.retention10sCtr ?? "",
          retention3sCvr: row.retention3sCvr ?? "",
          retention10sCvr: row.retention10sCvr ?? "",
          ctr: row.ctr ?? "",
          cost: row.cost ?? "",
          likes: row.like ?? "",
          engagementScore: row.engagementScore ?? "",
          sourceType: row.sourceType ?? "",
          industryCode: row.industryCode ?? "",
          hasOcr: row.hasOcr,
          ocrText,
          ocrFrameCount: row.ocrFrames.length,
          ocrFrameSeconds: row.ocrFrames.map((frame) => Math.round(frame.second)).join("|"),
          conversionSpikes: row.spikeSeconds.join("|"),
          transcript,
        };
      }),
    [rows],
  );
  const visibleAssetIds = useMemo(() => rows.map((row) => row.asset.id), [rows]);
  const allVisibleSelected =
    visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedAssetIds.includes(id));
  const selectedCount = selectedAssetIds.length;

  useEffect(() => {
    setSelectedAssetIds((prev) => prev.filter((id) => visibleAssetIds.includes(id)));
  }, [visibleAssetIds]);

  function toggleSelectAsset(assetId: string) {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedAssetIds((prev) => prev.filter((id) => !visibleAssetIds.includes(id)));
      return;
    }
    setSelectedAssetIds((prev) => Array.from(new Set([...prev, ...visibleAssetIds])));
  }

  async function handleDeleteAsset(assetId: string) {
    if (!window.confirm("Delete this data point? This cannot be undone.")) return;

    setDeletingAssetId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete data point");
      }
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
      setSelectedAssetIds((prev) => prev.filter((id) => id !== assetId));
    } catch (e: any) {
      setError(e?.message || "Failed to delete data point");
    } finally {
      setDeletingAssetId(null);
    }
  }

  async function handleDeleteSelected() {
    if (selectedAssetIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedAssetIds.length} selected data point(s)? This cannot be undone.`)) {
      return;
    }

    setBulkDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: selectedAssetIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete selected data points");
      }
      setAssets((prev) => prev.filter((asset) => !selectedAssetIds.includes(asset.id)));
      setSelectedAssetIds([]);
    } catch (e: any) {
      setError(e?.message || "Failed to delete selected data points");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDeleteAll() {
    if (rows.length === 0) return;
    if (!window.confirm("Delete all data points in this view? This cannot be undone.")) return;

    setDeletingAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAll: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete all data points");
      }
      setAssets([]);
      setSelectedAssetIds([]);
    } catch (e: any) {
      setError(e?.message || "Failed to delete all data points");
    } finally {
      setDeletingAll(false);
    }
  }

  function handleExportCsv() {
    if (exportRows.length === 0) return;
    const columns = [
      "createdAt",
      "updatedAt",
      "assetId",
      "jobId",
      "platform",
      "isSwipeFile",
      "swipeViews",
      "swipeTemplateExtracted",
      "videoUrl",
      "retention3s",
      "retention10s",
      "retention3sCtr",
      "retention10sCtr",
      "retention3sCvr",
      "retention10sCvr",
      "duration",
      "ctr",
      "cost",
      "likes",
      "engagementScore",
      "sourceType",
      "industryCode",
      "hasOcr",
      "ocrText",
      "ocrFrameCount",
      "ocrFrameSeconds",
      "conversionSpikes",
      "transcript",
    ];
    const suffix = highlightOcr ? "ad-ocr" : "ad-collection";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`${suffix}-${runId}-${timestamp}.csv`, columns, exportRows);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-8 h-8 border-2 border-accent-2/20 border-t-accent-2 rounded-full animate-spin" />
          <p className="text-label font-mono text-muted tracking-wide animate-pulse">Scanning Assets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8 space-y-6">
        <PageHeader
          backHref={researchHubBackHref}
          backLabel="Back to Research Hub"
          title={pageTitle}
          description="Unable to load ad assets."
        />
        <EmptyState title="Asset load failed" description={error} variant="error" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel backdrop-blur-md px-8 py-6">
        <PageHeader
          backHref={researchHubBackHref}
          backLabel="Back to Research Hub"
          title={pageTitle}
          description={`Job Type: ${highlightOcr ? "Ad OCR" : "Ad Collection"} | Assets: ${rows.length}`}
          actions={
            <>
              <button
                onClick={() => setShowInputs((current) => !current)}
                disabled={!sourceJobPayload}
                className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest disabled:opacity-20"
              >
                {showInputs ? "Hide Inputs" : "View Inputs"}
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedCount === 0 || bulkDeleting || deletingAll}
                className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest hover:text-danger hover:border-danger/30 disabled:opacity-20"
              >
                {bulkDeleting ? "Deleting..." : `Delete Selected (${selectedCount})`}
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={rows.length === 0 || deletingAll || bulkDeleting}
                className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest hover:text-danger hover:border-danger/30 disabled:opacity-20"
              >
                {deletingAll ? "Deleting All..." : "Delete All"}
              </button>
              <button
                onClick={handleExportCsv}
                disabled={rows.length === 0}
                className="btn btn-primary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest disabled:opacity-20"
              >
                {`Export ${pageTitle}`}
              </button>
            </>
          }
        />
      </div>

      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        {showInputs && sourceJobPayload && (
          <SectionCard padding="none" className="overflow-hidden">
            <div className="border-b border-line bg-bg-elevated px-6 py-3 flex items-center justify-between">
              <p className="eyebrow !mb-0">Input Parameters</p>
              <p className="eyebrow !mb-0 opacity-60">{highlightOcr ? "OCR Request" : "Collection Request"}</p>
            </div>
            <div className="p-6 bg-panel">
              <pre className="max-h-[32rem] overflow-auto text-body-sm font-mono text-muted leading-relaxed whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-line">
                {JSON.stringify(sourceJobPayload, null, 2)}
              </pre>
            </div>
          </SectionCard>
        )}

        <SectionCard padding="none" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-line bg-bg-elevated flex items-center justify-between">
            <p className="eyebrow !mb-0">Creative Assets</p>
            {highlightOcr && (
              <div className="flex items-center gap-4 text-label-sm font-mono uppercase tracking-widest">
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
                  <span className="text-success">OCR Ready</span>
                </span>
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-danger"></div>
                  <span className="text-danger">Needs Review</span>
                </span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1760px]">
              <thead className="bg-bg-elevated border-b border-line">
                <tr>
                  <th className="px-5 py-4 text-left w-12">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-3.5 w-3.5 rounded border-line bg-bg-elevated text-accent focus:ring-accent/20"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-40">Timestamp</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-32">Asset ID</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-32">Classification</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24">Linkage</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em]">Source URL</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-32 text-center">OCR Status</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">3s Ret.</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">10s Ret.</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">CTR 3s</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">CTR 10s</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">CVR 3s</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">CVR 10s</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-20 text-right">Dur</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">CTR</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">Cost</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-right">Like</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-20 text-center">Engage</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-28">Source</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-28">Industry</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-28">Spikes</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-48">Frame Analysis</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-24 text-center">Raw</th>
                  <th className="px-5 py-4 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-28 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {rows.map((row) => (
                  <tr
                    key={row.asset.id}
                    className={`align-top hover:bg-panel/[0.02] transition-colors group ${
                      highlightOcr
                        ? row.hasOcr
                          ? "bg-success/5"
                          : "bg-danger/5"
                        : ""
                    }`}
                  >
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.includes(row.asset.id)}
                        onChange={() => toggleSelectAsset(row.asset.id)}
                        className="h-3.5 w-3.5 rounded border-line bg-bg-elevated text-accent focus:ring-accent/20"
                        aria-label={`Select ${row.asset.id}`}
                      />
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-muted">
                      {new Date(row.asset.createdAt).toLocaleDateString()}
                      <br />
                      {new Date(row.asset.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-white">{row.asset.id.substring(0, 8)}</td>
                    <td className="px-5 py-4">
                      {row.isSwipeFile ? (
                        <div className="flex flex-col gap-1.5">
                          <StatusChip variant="warning" className="!text-label-xs uppercase font-bold tracking-widest !py-0.5">
                            Swipe_File
                          </StatusChip>
                          {row.swipeViews !== null && (
                            <span className="text-label font-mono text-accent uppercase tracking-widest whitespace-nowrap">
                              {Math.round(row.swipeViews).toLocaleString()} VIEWS
                            </span>
                          )}
                          <span className={`text-label-sm font-mono uppercase tracking-widest ${row.hasSwipeMetadata ? 'text-success/60' : 'text-muted/40'}`}>
                            {row.hasSwipeMetadata ? "✓ EXTRACTED" : "PENDING"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-label font-mono text-muted/20 uppercase tracking-widest">Standard</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-muted">{row.asset.jobId?.substring(0, 8) ?? "—"}</td>
                    <td className="px-5 py-4 text-body-sm">
                      {row.videoUrl ? (
                        <a
                          href={row.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent-2/60 hover:text-accent-2 hover:underline break-all transition-colors font-mono"
                        >
                          {row.videoUrl}
                        </a>
                      ) : (
                        <span className="text-muted/20">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {row.hasOcr ? (
                        <StatusChip variant="success" className="!text-label-xs !py-0.5 inline-flex">OCR Ready</StatusChip>
                      ) : (
                        <StatusChip variant="danger" className="!text-label-xs !py-0.5 inline-flex">No OCR</StatusChip>
                      )}
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention3s)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention10s)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention3sCtr)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention10sCtr)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention3sCvr)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.retention10sCvr)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.duration)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.ctr)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.cost)}</td>
                    <td className="px-5 py-4 text-label font-mono text-white text-right">{formatMetric(row.like)}</td>
                    <td className="px-5 py-4 text-center">
                      <span className="text-body-sm font-mono font-bold text-accent-2">
                        {formatMetric(row.engagementScore)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-muted uppercase">{row.sourceType ?? "—"}</td>
                    <td className="px-5 py-4 text-label font-mono text-muted uppercase">{row.industryCode ?? "—"}</td>
                    <td className="px-5 py-4 text-label font-mono text-accent">
                      {row.spikeSeconds.length ? row.spikeSeconds.map(s => `${s}s`).join(", ") : "—"}
                    </td>
                    <td className="px-5 py-4">
                      {row.ocrFrames.length === 0 ? (
                        <span className="text-label font-mono text-muted/20 uppercase tracking-widest">No Frames</span>
                      ) : (
                        <details className="group/details">
                          <summary className="cursor-pointer text-label font-mono text-accent-2/60 hover:text-accent-2 uppercase tracking-widest list-none flex items-center gap-2">
                            <span className="transition-transform group-open/details:rotate-90">▶</span>
                            Frames_{row.ocrFrames.length}
                          </summary>
                          <div className="mt-4 space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                            {row.ocrFrames.map((frame, idx) => {
                              const isSpike = row.spikeSeconds.includes(Math.round(frame.second));
                              return (
                                <div
                                  key={`${row.asset.id}-ocr-${idx}`}
                                  className={`rounded-card border p-3 flex flex-col gap-3 ${
                                    isSpike
                                      ? "border-warning/30 bg-warning/5"
                                      : "border-line bg-bg-elevated"
                                  }`}
                                >
                                  <div className="flex items-center justify-between border-b border-line/50 pb-2">
                                    <div className="text-label-sm font-mono text-muted uppercase tracking-widest">
                                      Frame_{idx + 1} @ {formatSeconds(frame.second)}
                                      {isSpike && <span className="text-warning ml-2">[CONVERSION_SPIKE]</span>}
                                    </div>
                                    <div className="text-label-sm font-mono text-muted uppercase">
                                      {formatConfidence(frame.confidence)} CONF
                                    </div>
                                  </div>

                                  {frame.imageUrl && (
                                    <a
                                      href={frame.imageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="relative aspect-video w-full rounded border border-line overflow-hidden bg-panel group/img"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={frame.imageUrl}
                                        alt={`OCR frame ${idx + 1} @ ${formatSeconds(frame.second)}`}
                                        className="object-contain w-full h-full"
                                      />
                                      <div className="absolute inset-0 bg-accent-2/0 group-hover/img:bg-accent-2/10 transition-colors flex items-center justify-center">
                                        <span className="text-white text-label font-mono font-black uppercase tracking-widest opacity-0 group-hover/img:opacity-100 transition-opacity">Expand View</span>
                                      </div>
                                    </a>
                                  )}

                                  <div className="text-body-sm font-mono text-white whitespace-pre-wrap leading-relaxed">
                                    {frame.text || <span className="text-muted/20">[DATA_VOID]</span>}
                                  </div>
                                  
                                  {!frame.textFound && (
                                    <div className="text-label-sm font-mono text-danger uppercase tracking-widest italic border-t border-line pt-2">
                                      Anomaly: No sequence detected in sampled vector
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <details className="group/json">
                        <summary className="cursor-pointer text-label font-mono text-muted/40 hover:text-white uppercase tracking-widest list-none">JSON</summary>
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-bg/90 backdrop-blur-xl group-open/json:flex hidden" onClick={(e) => {
                          if (e.target === e.currentTarget) {
                            (e.currentTarget.parentElement as any).removeAttribute('open');
                          }
                        }}>
                          <div className="bg-panel border border-line rounded-card w-full max-w-4xl max-h-full overflow-hidden flex flex-col shadow-2xl">
                            <div className="p-4 border-b border-line flex items-center justify-between bg-bg-elevated">
                              <span className="text-label font-mono text-white uppercase tracking-[0.2em] font-bold">Raw Data</span>
                              <button onClick={(e) => {
                                (e.currentTarget.closest('details') as any).removeAttribute('open');
                              }} className="text-muted hover:text-white font-mono text-label uppercase">Close [ESC]</button>
                            </div>
                            <pre className="p-6 overflow-auto text-body-sm font-mono text-muted leading-relaxed scrollbar-thin">
                              {JSON.stringify(row.raw, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => void handleDeleteAsset(row.asset.id)}
                        disabled={deletingAssetId === row.asset.id || bulkDeleting || deletingAll}
                        className="btn btn-secondary !min-h-[32px] px-4 text-label hover:text-danger hover:border-danger/30 disabled:opacity-40"
                      >
                        {deletingAssetId === row.asset.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
