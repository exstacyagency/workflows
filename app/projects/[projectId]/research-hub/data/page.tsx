"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

type JobStatus = "NOT_STARTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

type JobRecord = {
  id: string;
  type: string;
  status: JobStatus;
  runId: string | null;
  payload?: Record<string, any> | null;
  updatedAt?: string;
  createdAt: string;
};

type AdAsset = {
  id: string;
  jobId: string | null;
  platform: string;
  isSwipeFile?: boolean;
  swipeMetadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  rawJson: Record<string, any> | null;
};

type SupportedJobType = "ad-transcripts" | "ad-ocr" | "ad-collection" | "ad-quality-gate" | "pattern-analysis";
type CsvValue = string | number | boolean | null | undefined;

function asObj(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getSubtype(job: JobRecord): string {
  const payload = asObj(job.payload);
  const subtype = typeof payload.jobType === "string" ? payload.jobType : payload.kind;
  return typeof subtype === "string" ? subtype.trim() : "";
}

function getSupportedJobType(input: string): SupportedJobType | null {
  if (input === "ad-transcripts") return "ad-transcripts";
  if (input === "ad-ocr") return "ad-ocr";
  if (input === "ad-collection") return "ad-collection";
  if (input === "ad-quality-gate") return "ad-quality-gate";
  if (input === "pattern-analysis") return "pattern-analysis";
  return null;
}

function getVideoUrl(raw: Record<string, any>): string {
  const candidate =
    raw?.video_info?.video_url?.["720p"] ??
    raw?.video_info?.video_url?.["1080p"] ??
    raw?.url ??
    raw?.videoUrl ??
    raw?.mediaUrl ??
    "";
  return typeof candidate === "string" ? candidate : "";
}

function formatTimestampMs(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatConfidence(value: unknown): string {
  const n = asNum(value);
  if (n === null) return "—";
  if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
  return `${Math.round(n)}%`;
}

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

export default function ResearchHubDataPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = String(params?.projectId ?? "");
  const rawJobType = String(searchParams?.get("jobType") ?? "ad-transcripts").trim();
  const queryRunId = String(searchParams?.get("runId") ?? "").trim();
  const focusJobType = getSupportedJobType(rawJobType);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [effectiveRunId, setEffectiveRunId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AdAsset[]>([]);
  const [patternJob, setPatternJob] = useState<JobRecord | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [clearingAssetKey, setClearingAssetKey] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      if (!focusJobType) {
        setError(`Unsupported jobType: ${rawJobType}`);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setPatternJob(null);

        const jobsRes = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
        const jobsData = await jobsRes.json().catch(() => ({}));
        if (!jobsRes.ok || !jobsData?.success) {
          throw new Error(jobsData?.error || "Failed to load jobs");
        }
        const jobs = Array.isArray(jobsData.jobs) ? (jobsData.jobs as JobRecord[]) : [];

        const runId = queryRunId;
        if (!runId) {
          throw new Error("runId is required. Select a run from Research Hub and re-open View All Data.");
        }
        setEffectiveRunId(runId);

        if (focusJobType === "pattern-analysis") {
          const patternJobs = jobs
            .filter(
              (job) =>
                job.type === "PATTERN_ANALYSIS" &&
                job.runId === runId &&
                getSubtype(job) === "ad_pattern_analysis",
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          const latestPatternJob = patternJobs[0] ?? null;
          if (!latestPatternJob) {
            throw new Error(`No pattern analysis data found for runId=${runId}`);
          }
          setPatternJob(latestPatternJob);
          setAssets([]);
          return;
        }

        const assetsRes = await fetch(`/api/projects/${projectId}/runs/${runId}/ad-assets`, {
          cache: "no-store",
        });
        const assetsData = await assetsRes.json().catch(() => ({}));
        if (!assetsRes.ok || !assetsData?.success) {
          throw new Error(assetsData?.error || "Failed to load ad assets");
        }

        const rows = Array.isArray(assetsData.assets) ? (assetsData.assets as AdAsset[]) : [];
        setAssets(rows);
      } catch (e: any) {
        setError(e?.message || "Failed to load research hub data");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [focusJobType, projectId, queryRunId, rawJobType]);

  const patternResult = useMemo(() => {
    const payload = asObj(patternJob?.payload);
    return asObj(payload.result);
  }, [patternJob]);

  const transcriptRows = useMemo(
    () =>
      assets.map((asset) => {
        const raw = asObj(asset.rawJson);
        const metrics = asObj(raw.metrics);
        const transcriptText = typeof raw.transcript === "string" ? raw.transcript.trim() : "";
        const transcriptWords = Array.isArray(raw.transcriptWords) ? raw.transcriptWords : [];
        const transcriptSource = asObj(raw.transcriptSource);
        const firstWordMs = transcriptWords.length > 0 ? asNum(transcriptWords[0]?.start) : null;
        const lastWordMs =
          transcriptWords.length > 0 ? asNum(transcriptWords[transcriptWords.length - 1]?.end) : null;

        return {
          id: asset.id,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          adName:
            (typeof metrics.ad_title === "string" && metrics.ad_title) ||
            (typeof raw.ad_title === "string" && raw.ad_title) ||
            (typeof raw.pageName === "string" && raw.pageName) ||
            `Asset ${asset.id.slice(0, 8)}`,
          videoUrl: getVideoUrl(raw),
          transcriptText,
          transcriptWords,
          transcriptSource,
          wordRangeLabel: `${formatTimestampMs(firstWordMs)} - ${formatTimestampMs(lastWordMs)}`,
        };
      }),
    [assets],
  );

  const transcriptsWithText = transcriptRows.filter((row) => row.transcriptText.length > 0).length;

  const qualityRows = useMemo(
    () =>
      assets.map((asset) => {
        const raw = asObj(asset.rawJson);
        const qualityGate = asObj(raw.qualityGate);
        const viableValue = qualityGate.viable ?? raw.contentViable;
        const rawViableValue = qualityGate.rawViable;
        const confidenceValue = qualityGate.confidence ?? raw.qualityConfidence;
        const thresholdValue = qualityGate.confidenceThreshold;
        const issueValue = qualityGate.issue ?? raw.qualityIssue;
        const reasonValue = qualityGate.reason ?? raw.qualityReason;
        const assessedAtValue = qualityGate.assessedAt;

        return {
          id: asset.id,
          updatedAt: asset.updatedAt,
          isSwipeFile: Boolean(asset.isSwipeFile),
          videoUrl: getVideoUrl(raw),
          assessedAt:
            typeof assessedAtValue === "string" && assessedAtValue.trim().length > 0
              ? assessedAtValue
              : null,
          viable: typeof viableValue === "boolean" ? viableValue : null,
          rawViable: typeof rawViableValue === "boolean" ? rawViableValue : null,
          issue: typeof issueValue === "string" ? issueValue : "",
          confidence: asNum(confidenceValue),
          confidenceThreshold: asNum(thresholdValue),
          reason: typeof reasonValue === "string" ? reasonValue : "",
        };
      }),
    [assets],
  );

  const qualityAssessed = qualityRows.filter((row) => row.viable !== null || row.issue || row.reason).length;
  const qualityViable = qualityRows.filter((row) => row.viable === true).length;
  const qualityRejected = qualityRows.filter((row) => row.viable === false).length;
  const visibleAssetIds = useMemo(() => {
    if (focusJobType === "ad-transcripts") return transcriptRows.map((row) => row.id);
    if (focusJobType === "ad-quality-gate") return qualityRows.map((row) => row.id);
    return [];
  }, [focusJobType, qualityRows, transcriptRows]);
  const allVisibleSelected =
    visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedAssetIds.includes(id));
  const selectedCount = selectedAssetIds.length;

  useEffect(() => {
    setSelectedAssetIds((prev) => prev.filter((id) => visibleAssetIds.includes(id)));
  }, [visibleAssetIds]);

  const exportConfig = useMemo(() => {
    if (!focusJobType) {
      return { columns: [] as string[], rows: [] as Record<string, CsvValue>[] };
    }

    if (focusJobType === "ad-transcripts") {
      const columns = [
        "updatedAt",
        "assetId",
        "adName",
        "videoUrl",
        "transcriptText",
        "wordCount",
        "firstWordSecond",
        "lastWordSecond",
        "provider",
        "status",
        "confidence",
        "transcriptId",
      ];
      const rows = transcriptRows.map((row) => {
        const firstWordMs = row.transcriptWords.length > 0 ? asNum(row.transcriptWords[0]?.start) : null;
        const lastWordMs =
          row.transcriptWords.length > 0 ? asNum(row.transcriptWords[row.transcriptWords.length - 1]?.end) : null;
        return {
          updatedAt: row.updatedAt,
          assetId: row.id,
          adName: row.adName,
          videoUrl: row.videoUrl,
          transcriptText: row.transcriptText,
          wordCount: row.transcriptWords.length,
          firstWordSecond: firstWordMs === null ? "" : (firstWordMs / 1000).toFixed(2),
          lastWordSecond: lastWordMs === null ? "" : (lastWordMs / 1000).toFixed(2),
          provider: row.transcriptSource.provider ?? "",
          status: row.transcriptSource.status ?? "",
          confidence: row.transcriptSource.confidence ?? "",
          transcriptId: row.transcriptSource.transcriptId ?? "",
        };
      });
      return { columns, rows };
    }

    if (focusJobType === "ad-ocr") {
      const columns = [
        "updatedAt",
        "assetId",
        "videoUrl",
        "ocrText",
        "ocrFrameCount",
        "ocrFrameSeconds",
        "ocrFrameTexts",
      ];
      const rows = assets.map((asset) => {
        const raw = asObj(asset.rawJson);
        const ocrFrames = Array.isArray(raw.ocrFrames) ? raw.ocrFrames : [];
        return {
          updatedAt: asset.updatedAt,
          assetId: asset.id,
          videoUrl: getVideoUrl(raw),
          ocrText: typeof raw.ocrText === "string" ? raw.ocrText.trim() : "",
          ocrFrameCount: ocrFrames.length,
          ocrFrameSeconds: ocrFrames
            .map((frame) => asNum(asObj(frame).second))
            .filter((n): n is number => typeof n === "number")
            .map((n) => Math.round(n))
            .join("|"),
          ocrFrameTexts: ocrFrames
            .map((frame) => {
              const entry = asObj(frame);
              return typeof entry.text === "string" ? entry.text.trim() : "";
            })
            .filter(Boolean)
            .join(" | "),
        };
      });
      return { columns, rows };
    }

    if (focusJobType === "ad-quality-gate") {
      const columns = [
        "updatedAt",
        "assetId",
        "videoUrl",
        "isSwipeFile",
        "assessedAt",
        "viable",
        "rawViable",
        "issue",
        "confidence",
        "confidenceThreshold",
        "reason",
      ];
      const rows = qualityRows.map((row) => ({
        updatedAt: row.updatedAt,
        assetId: row.id,
        videoUrl: row.videoUrl,
        isSwipeFile: row.isSwipeFile,
        assessedAt: row.assessedAt ?? "",
        viable: row.viable === null ? "" : row.viable,
        rawViable: row.rawViable === null ? "" : row.rawViable,
        issue: row.issue,
        confidence: row.confidence ?? "",
        confidenceThreshold: row.confidenceThreshold ?? "",
        reason: row.reason,
      }));
      return { columns, rows };
    }

    if (focusJobType === "pattern-analysis") {
      const patterns = asObj(patternResult.patterns);
      const columns = [
        "updatedAt",
        "jobId",
        "runId",
        "adsAnalyzed",
        "summary",
        "hookPatterns",
        "messagePatterns",
        "textOverlayPatterns",
        "ctaPatterns",
        "timingPatterns",
        "clusters",
      ];
      const rows = patternJob
        ? [
            {
              updatedAt: patternJob.updatedAt ?? patternJob.createdAt,
              jobId: patternJob.id,
              runId: patternJob.runId ?? "",
              adsAnalyzed: asNum(patternResult.adsAnalyzed) ?? "",
              summary:
                typeof patternResult.summary === "string"
                  ? patternResult.summary
                  : "",
              hookPatterns: Array.isArray(patterns.hookPatterns) ? patterns.hookPatterns.length : 0,
              messagePatterns: Array.isArray(patterns.messagePatterns) ? patterns.messagePatterns.length : 0,
              textOverlayPatterns: Array.isArray(patterns.textOverlayPatterns) ? patterns.textOverlayPatterns.length : 0,
              ctaPatterns: Array.isArray(patterns.ctaPatterns) ? patterns.ctaPatterns.length : 0,
              timingPatterns: Array.isArray(patterns.timingPatterns) ? patterns.timingPatterns.length : 0,
              clusters: Array.isArray(patterns.clusters) ? patterns.clusters.length : 0,
            },
          ]
        : [];
      return { columns, rows };
    }

    const columns = [
      "updatedAt",
      "assetId",
      "videoUrl",
      "industryCode",
      "sourceType",
      "engagementScore",
      "duration",
      "retention3s",
      "retention10s",
      "retention3sCtr",
      "retention10sCtr",
      "retention3sCvr",
      "retention10sCvr",
      "ctr",
      "cost",
      "likes",
      "conversionSpikes",
      "playRetainPoints",
      "retainCtrPoints",
      "retainCvrPoints",
      "convertCntPoints",
    ];
    const rows = assets.map((asset) => {
      const raw = asObj(asset.rawJson);
      const metrics = asObj(raw.metrics);
      const spikes = Array.isArray(metrics.conversion_spikes) ? metrics.conversion_spikes : [];
      const playRetainAnalysis = Array.isArray(metrics.play_retain_cnt) ? metrics.play_retain_cnt : [];
      const retainCtrAnalysis = Array.isArray(metrics.retain_ctr) ? metrics.retain_ctr : [];
      const retainCvrAnalysis = Array.isArray(metrics.retain_cvr) ? metrics.retain_cvr : [];
      const convertCntAnalysis = Array.isArray(metrics.convert_cnt) ? metrics.convert_cnt : [];
      return {
        updatedAt: asset.updatedAt,
        assetId: asset.id,
        videoUrl: getVideoUrl(raw),
        industryCode: metrics.industry_code ?? "",
        sourceType: metrics.source_type ?? "",
        engagementScore: metrics.engagement_score ?? "",
        duration: metrics.duration ?? "",
        retention3s: metrics.retention_3s ?? "",
        retention10s: metrics.retention_10s ?? "",
        retention3sCtr: metrics.retention_3s_ctr ?? "",
        retention10sCtr: metrics.retention_10s_ctr ?? "",
        retention3sCvr: metrics.retention_3s_cvr ?? "",
        retention10sCvr: metrics.retention_10s_cvr ?? "",
        ctr: metrics.ctr ?? "",
        cost: metrics.cost ?? "",
        likes: metrics.like ?? metrics.likes ?? "",
        conversionSpikes: spikes
          .map((value) => asNum(value))
          .filter((n): n is number => typeof n === "number")
          .map((n) => Math.round(n))
          .join("|"),
        playRetainPoints: playRetainAnalysis.length,
        retainCtrPoints: retainCtrAnalysis.length,
        retainCvrPoints: retainCvrAnalysis.length,
        convertCntPoints: convertCntAnalysis.length,
      };
    });
    return { columns, rows };
  }, [assets, focusJobType, patternJob, patternResult, qualityRows, transcriptRows]);

  function handleExportCsv() {
    if (!focusJobType) return;
    if (exportConfig.rows.length === 0) return;
    const safeRunId = effectiveRunId || "no-run";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`${focusJobType}-${safeRunId}-${timestamp}.csv`, exportConfig.columns, exportConfig.rows);
  }

  async function handleDeleteAsset(assetId: string) {
    if (!effectiveRunId) {
      setError("Cannot delete asset without runId.");
      return;
    }
    if (!window.confirm("Delete this data point? This cannot be undone.")) return;

    setDeletingAssetId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${effectiveRunId}/ad-assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete data point");
      }
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
    } catch (e: any) {
      setError(e?.message || "Failed to delete data point");
    } finally {
      setDeletingAssetId(null);
    }
  }

  async function handleClearAssetData(assetId: string, mode: "transcript" | "ocr") {
    if (!effectiveRunId) {
      setError("Cannot clear fields without runId.");
      return;
    }

    const message =
      mode === "transcript"
        ? "Clear transcript fields for this ad (without deleting the ad)?"
        : "Clear OCR fields for this ad (without deleting the ad)?";
    if (!window.confirm(message)) return;

    const key = `${mode}:${assetId}`;
    setClearingAssetKey(key);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${effectiveRunId}/ad-assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          clearTranscript: mode === "transcript",
          clearOcr: mode === "ocr",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to clear asset fields");
      }

      setAssets((prev) =>
        prev.map((asset) => {
          if (asset.id !== assetId) return asset;
          const raw =
            asset.rawJson && typeof asset.rawJson === "object" && !Array.isArray(asset.rawJson)
              ? ({ ...asset.rawJson } as Record<string, any>)
              : {};

          if (mode === "transcript") {
            delete raw.transcript;
            delete raw.transcriptWords;
            delete raw.transcriptSource;
          } else {
            delete raw.ocrText;
            delete raw.ocrFrames;
            delete raw.ocrConfidence;
            const metrics =
              raw.metrics && typeof raw.metrics === "object" && !Array.isArray(raw.metrics)
                ? ({ ...raw.metrics } as Record<string, any>)
                : null;
            if (metrics) {
              delete metrics.ocr_meta;
              raw.metrics = metrics;
            }
          }

          return {
            ...asset,
            updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : asset.updatedAt,
            rawJson: raw,
          };
        }),
      );
    } catch (e: any) {
      setError(e?.message || "Failed to clear asset fields");
    } finally {
      setClearingAssetKey(null);
    }
  }

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

  async function handleDeleteSelected() {
    if (!effectiveRunId || selectedAssetIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedAssetIds.length} selected data point(s)? This cannot be undone.`)) return;

    setBulkDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${effectiveRunId}/ad-assets`, {
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
    if (!effectiveRunId) return;
    if (!window.confirm("Delete all data points in this view/run? This cannot be undone.")) return;

    setDeletingAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${effectiveRunId}/ad-assets`, {
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

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        backHref={`/projects/${projectId}/research-hub`}
        backLabel="Back to Research Hub"
        title="Advertising Data Library"
        description={effectiveRunId ? `Active run: ${effectiveRunId}` : "Loading advertising data..."}
        actions={
          <>
            <StatusChip variant="subtle">{focusJobType ?? rawJobType}</StatusChip>
            <button
              onClick={handleExportCsv}
              disabled={loading || !!error || !focusJobType || exportConfig.rows.length === 0}
              className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest"
            >
              Export Advertising Data
            </button>
            {(focusJobType === "ad-transcripts" || focusJobType === "ad-quality-gate") && (
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedCount === 0 || bulkDeleting || deletingAll || !effectiveRunId}
                  className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest hover:text-danger hover:border-danger/30"
                >
                  {bulkDeleting ? 'DELETING...' : `DELETE SELECTED (${selectedCount})`}
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={deletingAll || bulkDeleting || assets.length === 0 || !effectiveRunId}
                  className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest hover:text-danger hover:border-danger/30"
                >
                  {deletingAll ? 'PURGING_ALL...' : 'PURGE_ALL'}
                </button>
              </div>
            )}
          </>
        }
      />

      {loading && (
        <LoadingState title="Querying datastore" variant="section" />
      )}

      {!loading && error && (
        <EmptyState title="Access refused" description={error} variant="error" />
      )}

      {!loading && !error && focusJobType === "ad-transcripts" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Assets Scanned</p>
              <div className="text-3xl font-bold text-white">{transcriptRows.length}</div>
            </SectionCard>
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Transcription Coverage</p>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-bold text-accent-2">{transcriptsWithText}</div>
                <div className="text-xs font-mono text-muted mb-1.5 uppercase tracking-widest">Verified</div>
              </div>
            </SectionCard>
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Missing Transcript</p>
              <div className="text-3xl font-bold text-danger">
                {Math.max(0, transcriptRows.length - transcriptsWithText)}
              </div>
            </SectionCard>
          </div>

          <SectionCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse">
                <thead>
                  <tr className="border-b border-line bg-bg-elevated">
                    <th className="px-6 py-4 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="h-3.5 w-3.5 rounded border-line bg-bg-elevated text-accent focus:ring-accent/20"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Trace Time</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Asset ID</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Source</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Transcript</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Time Range</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Provider</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {transcriptRows.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/5 transition-colors group align-top">
                      <td className="px-3 py-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.includes(row.id)}
                          onChange={() => toggleSelectAsset(row.id)}
                          className="h-4 w-4"
                          aria-label={`Select asset ${row.id}`}
                        />
                      </td>
                      <td className="px-6 py-4">
                         <div className="text-body-sm font-mono text-muted uppercase">
                           {new Date(row.updatedAt).toLocaleDateString()}<br/>
                           {new Date(row.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         </div>
                      </td>
                      <td className="px-6 py-4 space-y-1">
                        <div className="text-xs font-bold text-white group-hover:text-accent transition-colors">{row.adName}</div>
                        <div className="text-label-sm font-mono text-muted uppercase tracking-tight opacity-40">{row.id}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.videoUrl ? (
                          <a
                            href={row.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-2 hover:text-accent-2 underline break-all"
                          >
                            {row.videoUrl}
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-white">
                        {row.transcriptText ? (
                          <details>
                            <summary className="cursor-pointer text-accent-2 hover:text-accent-2">
                              View transcript ({row.transcriptText.length} chars)
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap break-words">{row.transcriptText}</p>
                          </details>
                        ) : (
                          <span className="text-accent">No transcript text</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        <div>{row.wordRangeLabel}</div>
                        <div className="text-muted mt-1">{row.transcriptWords.length} words</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        <div>Provider: {row.transcriptSource.provider || "—"}</div>
                        <div className="mt-1">Status: {row.transcriptSource.status || "—"}</div>
                        <div className="mt-1">
                          Confidence: {formatConfidence(row.transcriptSource.confidence)}
                        </div>
                        <div className="mt-1 font-mono text-muted break-all">
                          Transcript ID: {row.transcriptSource.transcriptId || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => handleClearAssetData(row.id, "transcript")}
                            disabled={clearingAssetKey === `transcript:${row.id}` || deletingAssetId === row.id}
                            className="rounded border border-accent/30 px-2 py-1 text-accent hover:bg-accent/10 disabled:opacity-50"
                          >
                            {clearingAssetKey === `transcript:${row.id}` ? "Clearing..." : "Clear Transcript"}
                          </button>
                          <button
                            onClick={() => handleClearAssetData(row.id, "ocr")}
                            disabled={clearingAssetKey === `ocr:${row.id}` || deletingAssetId === row.id}
                            className="rounded border border-accent-2/30 px-2 py-1 text-accent-2 hover:bg-accent-2/10 disabled:opacity-50"
                          >
                            {clearingAssetKey === `ocr:${row.id}` ? "Clearing..." : "Clear OCR"}
                          </button>
                          <button
                            onClick={() => handleDeleteAsset(row.id)}
                            disabled={deletingAssetId === row.id || Boolean(clearingAssetKey)}
                            className="rounded border border-accent/30 px-2 py-1 text-accent hover:bg-accent/20 disabled:opacity-50"
                          >
                            {deletingAssetId === row.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {!loading && !error && focusJobType === "ad-quality-gate" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Assets Evaluated</p>
              <div className="text-3xl font-bold text-white">{qualityRows.length}</div>
            </SectionCard>
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Approved Ads</p>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-bold text-success">{qualityViable}</div>
                <div className="text-xs font-mono text-muted mb-1.5 uppercase tracking-widest">Verified</div>
              </div>
            </SectionCard>
            <SectionCard className="space-y-2">
              <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Rejected Nodes</p>
              <div className="text-3xl font-bold text-danger">{qualityRejected}</div>
            </SectionCard>
          </div>

          <div className="flex items-center gap-2 text-label font-mono text-muted uppercase tracking-widest">
            <div className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            Assessed Assets: <span className="text-white ml-1">{qualityAssessed}</span>
          </div>

          <SectionCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse">
                <thead>
                  <tr className="border-b border-line bg-bg-elevated">
                    <th className="px-6 py-4 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="h-3.5 w-3.5 rounded border-line bg-bg-elevated text-accent focus:ring-accent/20"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Trace Time</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Asset ID</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Source</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Swipe</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Verified</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Viable</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Raw</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Issue</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Confidence</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Reasoning</th>
                    <th className="px-6 py-4 text-left text-label font-mono text-muted uppercase tracking-widest font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {qualityRows.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/5 transition-colors group align-top">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.includes(row.id)}
                          onChange={() => toggleSelectAsset(row.id)}
                          className="h-3.5 w-3.5 rounded border-line bg-bg-elevated text-accent focus:ring-accent/20"
                          aria-label={`Select ${row.id}`}
                        />
                      </td>
                      <td className="px-6 py-4">
                         <div className="text-body-sm font-mono text-muted uppercase">
                           {new Date(row.updatedAt).toLocaleDateString()}<br/>
                           {new Date(row.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-label font-mono text-white opacity-80 uppercase tracking-tight">{row.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        {row.videoUrl ? (
                          <a
                            href={row.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-body-sm font-mono text-accent-2 hover:text-white underline transition-colors break-all opacity-80"
                          >
                            [Link_External]
                          </a>
                        ) : (
                          <span className="text-muted/40">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {row.isSwipeFile ? (
                          <StatusChip variant="info" className="!text-label-xs !px-1.5 !py-0 !h-4 uppercase tracking-widest">Swipe</StatusChip>
                        ) : (
                          <span className="text-muted/20">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-label font-mono text-muted uppercase">
                          {row.assessedAt ? new Date(row.assessedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusChip
                          variant={row.viable === true ? "success" : row.viable === false ? "danger" : "subtle"}
                          className="!text-label-xs !px-1.5 !py-0 !h-4"
                        >
                          {row.viable === true ? 'YES' : row.viable === false ? 'NO' : 'NULL'}
                        </StatusChip>
                      </td>
                      <td className="px-6 py-4 opacity-40">
                        <StatusChip
                          variant={row.rawViable === true ? "success" : row.rawViable === false ? "danger" : "subtle"}
                          className="!text-label-xs !px-1.5 !py-0 !h-4"
                        >
                          {row.rawViable === true ? 'YES' : row.rawViable === false ? 'NO' : 'NULL'}
                        </StatusChip>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-body-sm font-mono text-white opacity-80 uppercase tracking-tight">
                          {row.issue || "No issue"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-body-sm font-mono text-accent-2/80">
                          {row.confidence === null ? "—" : `${Math.round(row.confidence)}/${row.confidenceThreshold ?? "80"}`}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-muted leading-relaxed line-clamp-2 max-w-xs">
                          {row.reason || <span className="opacity-20 italic font-mono uppercase text-label">No analysis provided</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDeleteAsset(row.id)}
                          disabled={deletingAssetId === row.id}
                          className="text-label-sm font-mono text-muted hover:text-danger uppercase tracking-widest transition-colors text-left"
                        >
                          {deletingAssetId === row.id ? '[Purging...]' : '[Delete_Node]'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {!loading && !error && focusJobType === "pattern-analysis" && (
        <div className="space-y-4">
          {!patternJob ? (
            <EmptyState title="No pattern analysis result found for this run." />
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <SectionCard className="space-y-2">
                  <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Ads Synthesized</p>
                  <div className="text-3xl font-bold text-white">
                    {asNum(patternResult.adsAnalyzed) ?? 0}
                  </div>
                </SectionCard>
                <SectionCard className="space-y-2">
                  <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Hook Vectors</p>
                  <div className="flex items-end gap-3">
                    <div className="text-3xl font-bold text-accent">
                      {Array.isArray(asObj(patternResult.patterns).hookPatterns)
                        ? asObj(patternResult.patterns).hookPatterns.length
                        : 0}
                    </div>
                    <div className="text-xs font-mono text-muted mb-1.5 uppercase tracking-widest">Active</div>
                  </div>
                </SectionCard>
                <SectionCard className="space-y-2">
                  <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Logic Clusters</p>
                  <div className="text-3xl font-bold text-accent-2">
                    {Array.isArray(asObj(patternResult.patterns).clusters)
                      ? asObj(patternResult.patterns).clusters.length
                      : 0}
                  </div>
                </SectionCard>
              </div>

              <SectionCard padding="lg" className="space-y-6">
                <div className="flex items-center justify-between border-b border-line/40 pb-4">
                   <p className="card-label font-bold">Analysis Summary</p>
                   <div className="text-label font-mono text-muted uppercase tracking-[0.2em] opacity-40">
                     Job ID: <span className="text-accent-2">{patternJob.id}</span>
                   </div>
                </div>
                <p className="text-sm text-muted leading-relaxed font-medium">
                  {typeof patternResult.summary === "string" && patternResult.summary.trim().length > 0
                    ? patternResult.summary
                    : "No summary available."}
                </p>
              </SectionCard>

              <SectionCard padding="lg" className="space-y-4">
                <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40 font-bold">Raw Analysis Output</p>
                <div className="rounded bg-panel p-4 overflow-hidden">
                  <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-label font-mono text-muted scrollbar-thin scrollbar-thumb-line">
                    {JSON.stringify(patternResult, null, 2)}
                  </pre>
                </div>
              </SectionCard>
            </div>
          )}
        </div>
      )}

      {!loading &&
        !error &&
        focusJobType !== "ad-transcripts" &&
        focusJobType !== "ad-quality-gate" &&
        focusJobType !== "pattern-analysis" && (
        <div className="rounded border border-accent/30 bg-accent/10 p-4 text-accent text-sm">
          jobType=<span className="font-mono">{focusJobType ?? rawJobType}</span> is not yet implemented on this
          viewer. Use ad-assets run pages for collection/OCR data.
        </div>
      )}
    </div>
  );
}
