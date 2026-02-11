import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { AdPlatform, JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { uploadFrame } from "@/lib/s3Service";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const AD_BATCH_SIZE = 10;
const parsedMaxFrames = Number(cfg.raw("AD_OCR_MAX_FRAMES"));
const MAX_FRAMES_PER_AD =
  Number.isFinite(parsedMaxFrames) && parsedMaxFrames > 0 ? Math.floor(parsedMaxFrames) : 5;

let ffmpegCheckDone = false;
let ffmpegAvailable = false;

type OcrFrameResult = {
  second: number;
  text: string;
  confidence: number | null;
  imageUrl: string | null;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((v) => Number.isFinite(v) && v >= 0))).sort((a, b) => a - b);
}

function toSecond(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (isPlainObject(value)) {
    return firstNumber(value.second, value.time, value.t, value.timestamp, value.value);
  }
  return null;
}

function parseHighlightSeconds(rawJson: unknown): number[] {
  const raw = isPlainObject(rawJson) ? rawJson : {};
  const metrics = isPlainObject(raw.metrics) ? raw.metrics : {};
  const metricKeyframe = isPlainObject(metrics.keyframe_metrics) ? metrics.keyframe_metrics : {};
  const rawKeyframe = isPlainObject(raw.keyframe_metrics) ? raw.keyframe_metrics : {};
  const keyframe = isPlainObject(metricKeyframe) ? metricKeyframe : rawKeyframe;
  const convert = isPlainObject(keyframe.convert_cnt) ? keyframe.convert_cnt : {};
  const click = isPlainObject(keyframe.click_cnt) ? keyframe.click_cnt : {};

  const conversionSpikes = Array.isArray(metrics.conversion_spikes) ? metrics.conversion_spikes : [];
  const convertHighlights = Array.isArray(convert.highlight) ? convert.highlight : [];
  const clickHighlights = Array.isArray(click.highlight) ? click.highlight : [];
  const candidates =
    conversionSpikes.length > 0 ? conversionSpikes : [...convertHighlights, ...clickHighlights];

  const asSeconds = candidates
    .map((entry) => toSecond(entry))
    .filter((v): v is number => typeof v === "number")
    .map((v) => Math.max(0, Math.round(v)));

  const unique = uniqueSortedNumbers(asSeconds);
  if (unique.length === 0) return [0];
  return unique.slice(0, Math.max(1, MAX_FRAMES_PER_AD));
}

function extractVideoUrl(rawJson: unknown): string | null {
  const raw = isPlainObject(rawJson) ? rawJson : {};
  return (
    firstString(
      raw?.video_info?.video_url?.["720p"],
      raw?.video_info?.video_url?.["1080p"],
      raw?.url,
      raw?.videoUrl,
      raw?.mediaUrl
    ) ?? null
  );
}

async function runCommand(cmd: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}

async function ensureFfmpegAvailable() {
  if (ffmpegCheckDone) {
    if (!ffmpegAvailable) {
      throw new Error("ffmpeg is not available in this runtime. Use Railway/Render/Docker or another non-Vercel worker.");
    }
    return;
  }

  ffmpegCheckDone = true;
  try {
    await runCommand("ffmpeg", ["-version"], "ffmpeg");
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    throw new Error("ffmpeg is not available in this runtime. Use Railway/Render/Docker or another non-Vercel worker.");
  }
}

async function downloadVideo(videoUrl: string, outputPath: string) {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

async function extractFramesAtHighlights(videoPath: string, framesDir: string, seconds: number[]) {
  if (seconds.length === 0) return [];

  const selectExpr = seconds.map((s) => `eq(t\\,${s})`).join("+");
  const framePattern = path.join(framesDir, "frame_%03d.png");
  const ffmpegArgs = [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `select=${selectExpr}`,
    "-vsync",
    "0",
    framePattern,
  ];

  await runCommand("ffmpeg", ffmpegArgs, "ffmpeg frame extraction");
  const files = await fs.readdir(framesDir);
  return files
    .filter((file) => /^frame_\d+\.png$/i.test(file))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => path.join(framesDir, file));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function detectTextWithGoogleVision(framePath: string, apiKey: string): Promise<{ text: string; confidence: number | null }> {
  const bytes = await fs.readFile(framePath);
  const base64 = bytes.toString("base64");

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Vision OCR failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as any;
  const result = payload?.responses?.[0] ?? {};
  const text =
    firstString(result?.fullTextAnnotation?.text, result?.textAnnotations?.[0]?.description) ?? "";

  const pageConfidences: number[] = (result?.fullTextAnnotation?.pages ?? [])
    .flatMap((page: any) => (page?.blocks ?? []).map((block: any) => firstNumber(block?.confidence)))
    .filter((v: number | null): v is number => typeof v === "number");

  const confidence = average(pageConfidences);
  return { text: text.trim(), confidence };
}

function mergeOcrText(frames: OcrFrameResult[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const frame of frames) {
    const normalized = frame.text.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(normalized);
  }
  return lines.join("\n");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function processSingleAd(assetId: string, apiKey: string, forceReprocess: boolean) {
  const asset = await prisma.adAsset.findUnique({
    where: { id: assetId },
    select: { id: true, rawJson: true },
  });
  if (!asset) return { processed: false, reason: "not_found", apiCalls: 0, framesExtracted: 0 };

  const raw = isPlainObject(asset.rawJson) ? (asset.rawJson as Record<string, any>) : {};
  const existingOcr = firstString(raw.ocrText);
  if (!forceReprocess && existingOcr) {
    return { processed: false, reason: "already_processed", apiCalls: 0, framesExtracted: 0 };
  }

  const videoUrl = extractVideoUrl(raw);
  if (!videoUrl) return { processed: false, reason: "missing_video_url", apiCalls: 0, framesExtracted: 0 };

  const highlightSeconds = parseHighlightSeconds(raw);
  console.log("[OCR Debug] Asset:", assetId);
  console.log("[OCR Debug] Raw conversion spikes:", raw?.metrics?.conversion_spikes ?? null);
  console.log(
    "[OCR Debug] Raw keyframe convert highlights:",
    raw?.metrics?.keyframe_metrics?.convert_cnt?.highlight ??
      raw?.keyframe_metrics?.convert_cnt?.highlight ??
      null
  );
  console.log("[OCR Debug] Highlight seconds extracted:", highlightSeconds);
  console.log("[OCR Debug] Will extract frames at:", highlightSeconds);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ad-ocr-"));
  const videoPath = path.join(tempDir, "video.mp4");
  const framesDir = path.join(tempDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  try {
    await downloadVideo(videoUrl, videoPath);
    for (const second of highlightSeconds) {
      console.log("[OCR Debug] Extracting frame at second:", second, "for asset:", assetId);
    }
    const framePaths = await extractFramesAtHighlights(videoPath, framesDir, highlightSeconds);

    const ocrFrames: OcrFrameResult[] = [];
    let apiCalls = 0;

    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      const second = highlightSeconds[i] ?? highlightSeconds[highlightSeconds.length - 1] ?? 0;
      const result = await detectTextWithGoogleVision(framePath, apiKey);
      apiCalls += 1;
      let imageUrl: string | null = null;
      try {
        imageUrl = await uploadFrame(framePath, assetId, second);
      } catch (error: any) {
        console.warn(
          "[OCR Debug] Failed to upload frame:",
          String(error?.message ?? error),
          "asset:",
          assetId,
          "second:",
          second
        );
      }
      if (!result.text) continue;
      ocrFrames.push({
        second,
        text: result.text,
        confidence: result.confidence,
        imageUrl,
      });
    }

    const allText = mergeOcrText(ocrFrames);
    const avgConfidence = average(
      ocrFrames
        .map((frame) => frame.confidence)
        .filter((v): v is number => typeof v === "number")
    );

    const currentMetrics = isPlainObject(raw.metrics) ? raw.metrics : {};
    const nextRaw = {
      ...raw,
      ocrText: allText,
      ocrFrames,
      ocrConfidence: avgConfidence,
      metrics: {
        ...currentMetrics,
        ocr_meta: {
          provider: "google_vision",
          framesExtracted: framePaths.length,
          apiCalls,
          highlightSeconds,
          processedAt: new Date().toISOString(),
        },
      },
    };
    console.log(
      "[OCR Debug] Saved frames:",
      Array.isArray(nextRaw.ocrFrames)
        ? nextRaw.ocrFrames.map((f: any) => f?.timestamp ?? f?.second ?? null)
        : []
    );
    console.log(
      "[OCR Debug] Saved ocrFrames count:",
      Array.isArray(nextRaw.ocrFrames) ? nextRaw.ocrFrames.length : 0,
      "for asset:",
      assetId
    );

    await prisma.adAsset.update({
      where: { id: asset.id },
      data: { rawJson: nextRaw as any },
    });

    return {
      processed: true,
      reason: "ok",
      apiCalls,
      framesExtracted: framePaths.length,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runAdOcrCollection(args: {
  projectId: string;
  jobId: string;
  runId: string;
  forceReprocess?: boolean;
  onProgress?: (pct: number) => void;
}) {
  const { projectId, runId, forceReprocess = false, onProgress } = args;

  if (!runId || !String(runId).trim()) {
    throw new Error("runId is required for OCR collection");
  }

  const apiKey = cfg.raw("GOOGLE_CLOUD_VISION_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY must be set");
  }
  await ensureFfmpegAvailable();

  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
      job: {
        is: {
          runId,
        },
      },
    },
    select: { id: true, rawJson: true },
  });

  const assetsToProcess = forceReprocess
    ? assets
    : assets.filter((asset) => {
        const current = (asset.rawJson as any)?.ocrText;
        return !current || String(current).trim() === "";
      });

  if (assetsToProcess.length === 0) {
    return { totalAssets: 0, processed: 0, framesExtracted: 0, apiCalls: 0 };
  }

  const batches = chunk(assetsToProcess, AD_BATCH_SIZE);
  let processed = 0;
  let totalFrames = 0;
  let totalApiCalls = 0;
  const errors: Array<{ assetId: string; error: string }> = [];

  for (const batch of batches) {
    for (const asset of batch) {
      try {
        const result = await processSingleAd(asset.id, apiKey, forceReprocess);
        if (result.processed) processed += 1;
        totalFrames += result.framesExtracted;
        totalApiCalls += result.apiCalls;
      } catch (error: any) {
        errors.push({
          assetId: asset.id,
          error: String(error?.message ?? error),
        });
      }
      if (onProgress) {
        const done = processed + errors.length;
        onProgress(Math.floor((done / assetsToProcess.length) * 100));
      }
    }
  }

  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `OCR collection failed for ${errors.length}/${assetsToProcess.length} assets (first ${first.assetId}: ${first.error})`
    );
  }

  return {
    totalAssets: assetsToProcess.length,
    processed,
    framesExtracted: totalFrames,
    apiCalls: totalApiCalls,
  };
}

export async function startAdOcrJob(params: {
  projectId: string;
  jobId: string;
  runId: string;
  forceReprocess?: boolean;
}) {
  const { projectId, jobId, runId, forceReprocess } = params;
  await updateJobStatus(jobId, JobStatus.RUNNING);
  try {
    const result = await runAdOcrCollection({ projectId, jobId, runId, forceReprocess });
    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `OCR: ${result.processed}/${result.totalAssets} (frames ${result.framesExtracted}, api calls ${result.apiCalls})`,
      },
    });
    return { jobId, ...result };
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err?.message ?? "Unknown error in OCR collection",
      },
    });
    throw err;
  }
}
