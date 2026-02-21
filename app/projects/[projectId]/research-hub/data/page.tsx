"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

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

function resolveRunIdForJobType(jobs: JobRecord[], jobType: SupportedJobType): string | null {
  const subtypeMap: Record<SupportedJobType, string[]> = {
    "ad-transcripts": ["ad_transcripts", "ad_transcript_collection"],
    "ad-ocr": ["ad_ocr_collection"],
    "ad-collection": ["ad_raw_collection"],
    "ad-quality-gate": ["ad_quality_gate"],
    "pattern-analysis": ["ad_pattern_analysis"],
  };
  const typeMap: Record<SupportedJobType, string> = {
    "ad-transcripts": "AD_PERFORMANCE",
    "ad-ocr": "AD_PERFORMANCE",
    "ad-collection": "AD_PERFORMANCE",
    "ad-quality-gate": "AD_QUALITY_GATE",
    "pattern-analysis": "PATTERN_ANALYSIS",
  };

  const acceptedSubtypes = subtypeMap[jobType];
  const acceptedType = typeMap[jobType];
  const byCreatedAtDesc = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const completed = byCreatedAtDesc.find(
    (job) =>
      job.type === acceptedType &&
      job.status === "COMPLETED" &&
      !!job.runId &&
      acceptedSubtypes.includes(getSubtype(job)),
  );
  if (completed?.runId) return completed.runId;

  const anyStatus = byCreatedAtDesc.find(
    (job) =>
      job.type === acceptedType &&
      !!job.runId &&
      acceptedSubtypes.includes(getSubtype(job)),
  );
  return anyStatus?.runId ?? null;
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

        const runId = queryRunId || resolveRunIdForJobType(jobs, focusJobType);
        if (!runId) {
          throw new Error(`No run found for jobType=${focusJobType}`);
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
          <h1 className="text-2xl font-bold text-white">Research Hub Data</h1>
          <p className="text-sm text-slate-400 mt-1">
            jobType: <span className="font-mono">{focusJobType ?? rawJobType}</span>
            {effectiveRunId ? (
              <>
                {" "}
                · runId: <span className="font-mono">{effectiveRunId}</span>
              </>
            ) : null}
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={loading || !!error || !focusJobType || exportConfig.rows.length === 0}
          className={`px-3 py-2 text-sm rounded border ${
            loading || !!error || !focusJobType || exportConfig.rows.length === 0
              ? "border-slate-700 text-slate-500 cursor-not-allowed"
              : "border-slate-600 text-slate-200 hover:border-slate-500 hover:text-white"
          }`}
        >
          Export CSV
        </button>
      </div>

      {loading && (
        <div className="rounded border border-slate-700 bg-slate-900/60 p-4 text-slate-300 text-sm">
          Loading data...
        </div>
      )}

      {!loading && error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
      )}

      {!loading && !error && focusJobType === "ad-transcripts" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-white">{transcriptRows.length}</div>
              <p className="text-xs text-slate-400 mt-1">Ad assets in run</p>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-emerald-300">{transcriptsWithText}</div>
              <p className="text-xs text-slate-400 mt-1">Assets with transcript text</p>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-rose-300">
                {Math.max(0, transcriptRows.length - transcriptsWithText)}
              </div>
              <p className="text-xs text-slate-400 mt-1">Assets missing transcript text</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px]">
                <thead className="bg-slate-800/50 border-b border-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Updated</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Asset</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Video URL</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Transcript</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Timestamps</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">AssemblyAI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {transcriptRows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2 text-xs text-slate-300">{new Date(row.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        <div className="font-medium text-slate-200">{row.adName}</div>
                        <div className="font-mono text-slate-500 mt-1">{row.id}</div>
                      </td>
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
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {row.transcriptText ? (
                          <details>
                            <summary className="cursor-pointer text-sky-400 hover:text-sky-300">
                              View transcript ({row.transcriptText.length} chars)
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap break-words">{row.transcriptText}</p>
                          </details>
                        ) : (
                          <span className="text-rose-300">No transcript text</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        <div>{row.wordRangeLabel}</div>
                        <div className="text-slate-500 mt-1">{row.transcriptWords.length} words</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        <div>Provider: {row.transcriptSource.provider || "—"}</div>
                        <div className="mt-1">Status: {row.transcriptSource.status || "—"}</div>
                        <div className="mt-1">
                          Confidence: {formatConfidence(row.transcriptSource.confidence)}
                        </div>
                        <div className="mt-1 font-mono text-slate-500 break-all">
                          Transcript ID: {row.transcriptSource.transcriptId || "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && focusJobType === "ad-quality-gate" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-white">{qualityRows.length}</div>
              <p className="text-xs text-slate-400 mt-1">Ad assets in run</p>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-emerald-300">{qualityViable}</div>
              <p className="text-xs text-slate-400 mt-1">Viable ads</p>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xl font-semibold text-rose-300">{qualityRejected}</div>
              <p className="text-xs text-slate-400 mt-1">Rejected ads</p>
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
            Assessed assets: <span className="text-slate-200">{qualityAssessed}</span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px]">
                <thead className="bg-slate-800/50 border-b border-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Updated</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Asset ID</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Video URL</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Swipe</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Assessed</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Viable</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Raw Viable</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Issue</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Confidence</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {qualityRows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2 text-xs text-slate-300">{new Date(row.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-300">{row.id}</td>
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
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.isSwipeFile ? (
                          <span className="inline-flex rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
                            Swipe File
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.assessedAt ? new Date(row.assessedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.viable === null ? "—" : row.viable ? "Yes" : "No"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.rawViable === null ? "—" : row.rawViable ? "Yes" : "No"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">{row.issue || "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.confidence === null
                          ? "—"
                          : `${Math.round(row.confidence)}/${row.confidenceThreshold ?? "—"}`}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap break-words">
                        {row.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && focusJobType === "pattern-analysis" && (
        <div className="space-y-4">
          {!patternJob ? (
            <div className="rounded border border-slate-700 bg-slate-900/60 p-4 text-slate-300 text-sm">
              No pattern analysis result found for this run.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-xl font-semibold text-white">
                    {asNum(patternResult.adsAnalyzed) ?? 0}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Ads analyzed</p>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-xl font-semibold text-emerald-300">
                    {Array.isArray(asObj(patternResult.patterns).hookPatterns)
                      ? asObj(patternResult.patterns).hookPatterns.length
                      : 0}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Hook patterns</p>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-xl font-semibold text-sky-300">
                    {Array.isArray(asObj(patternResult.patterns).clusters)
                      ? asObj(patternResult.patterns).clusters.length
                      : 0}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Creative clusters</p>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-400 mb-2">
                  Job <span className="font-mono text-slate-300">{patternJob.id}</span>
                </div>
                <p className="text-sm text-slate-200">
                  {typeof patternResult.summary === "string" && patternResult.summary.trim().length > 0
                    ? patternResult.summary
                    : "No summary available."}
                </p>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <h2 className="text-sm font-semibold text-slate-200 mb-2">Raw Pattern Output</h2>
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">
                  {JSON.stringify(patternResult, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      )}

      {!loading &&
        !error &&
        focusJobType !== "ad-transcripts" &&
        focusJobType !== "ad-quality-gate" &&
        focusJobType !== "pattern-analysis" && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 text-sm">
          jobType=<span className="font-mono">{focusJobType ?? rawJobType}</span> is not yet implemented on this
          viewer. Use ad-assets run pages for collection/OCR data.
        </div>
      )}
    </div>
  );
}
