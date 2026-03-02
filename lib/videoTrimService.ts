import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { uploadTrimmedClipObject } from "@/lib/s3Service";

let ffmpegCheckDone = false;
let ffmpegCommand = "ffmpeg";

function runCommand(cmd: string, args: string[], context: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${context} failed (code ${code}): ${stderr.slice(-5000)}`));
    });
  });
}

async function ensureFfmpeg(): Promise<string> {
  if (ffmpegCheckDone) return ffmpegCommand;

  const candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  for (const candidate of candidates) {
    try {
      await runCommand(candidate, ["-version"], "ffmpeg check");
      ffmpegCommand = candidate;
      ffmpegCheckDone = true;
      return ffmpegCommand;
    } catch {
      // try next
    }
  }

  throw new Error(
    `ffmpeg is not available in this runtime. Tried: ${candidates.join(", ")}.`,
  );
}

function toSafeKeyPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function trimVideoClipToS3(args: {
  sourceUrl: string;
  trimStart: number;
  trimEnd: number;
  projectId: string;
  storyboardId: string;
  clipIndex: number;
  sceneNumber?: number;
}): Promise<string> {
  const sourceUrl = String(args.sourceUrl ?? "").trim();
  if (!sourceUrl) throw new Error("trimVideoClipToS3 requires sourceUrl");

  const trimStart = Number(args.trimStart);
  const trimEnd = Number(args.trimEnd);
  if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimEnd <= trimStart + 0.05) {
    throw new Error(`Invalid trim range: start=${args.trimStart}, end=${args.trimEnd}`);
  }

  const ffmpeg = await ensureFfmpeg();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "trim-"));
  const outputPath = path.join(tmpDir, "trimmed.mp4");

  try {
    const duration = trimEnd - trimStart;
    const ffmpegArgs = [
      "-y",
      "-ss",
      trimStart.toFixed(3),
      "-i",
      sourceUrl,
      "-t",
      duration.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    await runCommand(ffmpeg, ffmpegArgs, "ffmpeg trim");

    const body = await readFile(outputPath);
    const projectKey = toSafeKeyPart(args.projectId || "unknown-project");
    const storyboardKey = toSafeKeyPart(args.storyboardId || "unknown-storyboard");
    const scenePart =
      Number.isFinite(Number(args.sceneNumber)) && Number(args.sceneNumber) > 0
        ? `scene-${Number(args.sceneNumber)}`
        : `clip-${args.clipIndex + 1}`;
    const key = [
      "projects",
      projectKey,
      "storyboards",
      storyboardKey,
      "trimmed",
      `${scenePart}`,
      `v${Date.now()}-${Math.random().toString(36).slice(2, 10)}.mp4`,
    ].join("/");

    const uploadedUrl = await uploadTrimmedClipObject({
      key,
      body,
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
    });

    if (!uploadedUrl) {
      throw new Error(
        "Failed to upload trimmed clip. Check AWS_S3_BUCKET_TRIMMED_CLIPS/S3_TRIMMED_CLIPS configuration.",
      );
    }

    return uploadedUrl;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

