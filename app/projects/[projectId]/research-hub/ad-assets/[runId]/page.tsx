"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

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
    .map((item) => {
      const entry = asObj(item);
      const second = asNum(entry.second);
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      const confidence = asNum(entry.confidence);
      if (second === null || !text) return null;
      return {
        second,
        text,
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || "Failed to load ad assets");
        }
        setAssets(Array.isArray(data.assets) ? data.assets : []);
      } catch (e: any) {
        setError(e?.message || "Failed to load ad assets");
      } finally {
        setLoading(false);
      }
    }

    if (projectId && runId) {
      void load();
    }
  }, [projectId, runId]);

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

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/projects/${projectId}/research-hub`}
            className="text-sm text-slate-400 hover:text-slate-300 mb-2 inline-block"
          >
            ← Back to Research Hub
          </Link>
          <h1 className="text-2xl font-bold text-white">Ad Assets</h1>
          <p className="text-sm text-slate-400 mt-1">Run: {runId}</p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={loading || !!error || rows.length === 0}
          className={`px-3 py-2 text-sm rounded border ${
            loading || !!error || rows.length === 0
              ? "border-slate-700 text-slate-500 cursor-not-allowed"
              : "border-slate-600 text-slate-200 hover:border-slate-500 hover:text-white"
          }`}
        >
          Export CSV
        </button>
      </div>

      {loading && <div className="text-slate-400 text-sm">Loading ad assets...</div>}

      {!loading && error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded border border-slate-700 bg-slate-900/60 p-4 text-slate-300 text-sm">
          No ad assets found for this run.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300">
            {rows.length} ads
            {highlightOcr && (
              <span className="ml-3 text-xs text-slate-400">
                OCR highlighted: <span className="text-emerald-400">with OCR</span> /{" "}
                <span className="text-rose-400">missing OCR</span>
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1650px]">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Created</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Asset ID</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Swipe</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Job ID</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Video URL</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">OCR Status</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retention 3s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retention 10s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retain CTR 3s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retain CTR 10s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retain CVR 3s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Retain CVR 10s</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Duration</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">CTR</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Cost</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Likes</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Engagement</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Source</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Industry</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Spikes</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">OCR Details</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Raw</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => (
                  <tr
                    key={row.asset.id}
                    className={`align-top ${
                      highlightOcr
                        ? row.hasOcr
                          ? "bg-emerald-500/5"
                          : "bg-rose-500/5"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {new Date(row.asset.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 font-mono">{row.asset.id}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {row.isSwipeFile ? (
                        <div className="space-y-1">
                          <span className="inline-flex rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
                            Swipe File
                          </span>
                          <div className="text-[11px] text-slate-400">
                            {typeof row.swipeViews === "number"
                              ? `${Math.round(row.swipeViews).toLocaleString()} views`
                              : "views unavailable"}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {row.hasSwipeMetadata ? "template extracted" : "template pending"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 font-mono">{row.asset.jobId ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.videoUrl ? (
                        <a
                          href={row.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 underline break-all"
                        >
                          {row.videoUrl}
                        </a>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.hasOcr ? (
                        <span className="text-emerald-400">✓ OCR</span>
                      ) : (
                        <span className="text-rose-400">✕ Missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention3s)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention10s)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention3sCtr)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention10sCtr)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention3sCvr)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.retention10sCvr)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.duration)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.ctr)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.cost)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.like)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{formatMetric(row.engagementScore)}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{row.sourceType ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">{row.industryCode ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {row.spikeSeconds.length ? row.spikeSeconds.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {row.ocrFrames.length === 0 ? (
                        <span className="text-slate-500">No OCR frames</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sky-400 hover:text-sky-300">
                            OCR Frames ({row.ocrFrames.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {row.ocrFrames.map((frame, idx) => {
                              const isSpike = row.spikeSeconds.includes(Math.round(frame.second));
                              return (
                                <div
                                  key={`${row.asset.id}-ocr-${idx}`}
                                  className={`rounded border p-2 ${
                                    isSpike
                                      ? "border-amber-500/50 bg-amber-500/10"
                                      : "border-slate-700 bg-slate-900/40"
                                  }`}
                                >
                                  <div className="text-[11px] text-slate-400">
                                    Frame {idx + 1} at {formatSeconds(frame.second)}
                                    {isSpike ? " (conversion spike)" : ""}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-300">
                                    Confidence: {formatConfidence(frame.confidence)}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-200 whitespace-pre-wrap break-words">
                                    Text: {frame.text}
                                  </div>
                                  {frame.imageUrl ? (
                                    <div className="mt-2">
                                      <a
                                        href={frame.imageUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-block"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={frame.imageUrl}
                                          alt={`OCR frame ${idx + 1} at ${formatSeconds(frame.second)}`}
                                          className="h-20 w-auto rounded border border-slate-700"
                                        />
                                      </a>
                                    </div>
                                  ) : (
                                    <div className="mt-2 text-[11px] text-slate-500">
                                      No frame image URL
                                    </div>
                                  )}
                                  <div className="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words">
                                    Preview: {frame.text.slice(0, 200)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      <details>
                        <summary className="cursor-pointer text-slate-400 hover:text-slate-300">JSON</summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-300">
                          {JSON.stringify(row.raw, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
