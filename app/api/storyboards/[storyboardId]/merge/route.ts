// app/api/storyboards/[storyboardId]/merge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { env, requireEnv } from "@/lib/configGuard";
import { trimVideoClipToS3 } from "@/lib/videoTrimService";

const FAL_MERGE_URL = "https://fal.run/fal-ai/ffmpeg-api/merge-videos";

function falHeaders() {
  return {
    Authorization: `Key ${env("FAL_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollFalResponse(
  url: string,
  max = 30,
  delayMs = 10_000,
): Promise<any> {
  for (let i = 0; i < max; i++) {
    const res = await fetch(url, { headers: falHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fal poll failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (json.status === "succeeded") return json;
    if (json.status === "failed") throw new Error("Fal merge job failed");
    await wait(delayMs);
  }
  throw new Error("Fal merge job timed out after 5 minutes");
}

function getMergedVideoUrlFromFalResponse(payload: any): string | null {
  const candidates = [
    payload?.video?.url,
    payload?.data?.video?.url,
    payload?.result?.video?.url,
    payload?.resultUrls?.[0],
    payload?.data?.response?.resultUrls?.[0],
  ];
  for (const candidate of candidates) {
    const url = String(candidate ?? "").trim();
    if (url) return url;
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { storyboardId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storyboardId = String(params?.storyboardId ?? "").trim();
  if (!storyboardId) {
    return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
  }

  try {
    requireEnv(["FAL_API_KEY"], "FAL");
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Missing required FAL configuration" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  type ClipInput = { videoUrl: string; trimStart?: number; trimEnd?: number; sceneNumber?: number };

  const requestedClips: ClipInput[] | null = Array.isArray(body.clips)
    ? (body.clips as unknown[]).reduce<ClipInput[]>((acc, c) => {
        const url = String((c as any)?.videoUrl ?? "").trim();
        if (!url) return acc;
        acc.push({
          videoUrl: url,
          trimStart: Number.isFinite(Number((c as any)?.trimStart)) ? Number((c as any).trimStart) : 0,
          trimEnd: Number.isFinite(Number((c as any)?.trimEnd)) ? Number((c as any).trimEnd) : undefined,
          sceneNumber: Number.isFinite(Number((c as any)?.sceneNumber))
            ? Number((c as any).sceneNumber)
            : undefined,
        });
        return acc;
      }, [])
    : null;
  const projectId = String(body.projectId ?? "").trim();

  const requestedVideoUrls = Array.isArray(body.videoUrls)
    ? (body.videoUrls as unknown[]).map((u) => String(u ?? "").trim()).filter(Boolean)
    : null;

  const storyboard = await prisma.storyboard.findFirst({
    where: {
      id: storyboardId,
      project: { userId },
    },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      script: { select: { id: true, mergedVideoUrl: true } },
    },
  });

  if (!storyboard) {
    return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  }

  let clips: ClipInput[];
  if (requestedClips && requestedClips.length > 0) {
    clips = requestedClips;
  } else if (requestedVideoUrls && requestedVideoUrls.length > 0) {
    clips = requestedVideoUrls.map((url) => ({ videoUrl: url }));
  } else {
    clips = storyboard.scenes
      .map((s) => {
        const raw = s.rawJson as any;
        const url = String(raw?.videoUrl ?? raw?.video_url ?? "").trim();
        return url ? { videoUrl: url } : null;
      })
      .filter((c): c is ClipInput => c !== null);
  }
  const videoUrls = clips.map((c) => c.videoUrl);

  if (videoUrls.length === 0) {
    return NextResponse.json(
      { error: "No video URLs found. Generate scene videos first." },
      { status: 409 },
    );
  }

  if (videoUrls.length === 1) {
    const mergedVideoUrl = videoUrls[0];
    if (storyboard.script?.id) {
      await prisma.script.update({
        where: { id: storyboard.script.id },
        data: { mergedVideoUrl },
      });
    }
    return NextResponse.json({ ok: true, mergedVideoUrl, clipsUsed: 1 });
  }

  // Pre-trim each clip (when trim range is provided) and upload trimmed outputs to S3.
  // Order is preserved to match beat order in the UI.
  let clipsForMerge: string[];
  try {
    clipsForMerge = await Promise.all(
      clips.map(async (clip, clipIndex) => {
        const start = Number(clip.trimStart);
        const end = Number(clip.trimEnd);
        const hasTrimRange =
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end > start + 0.05;
        if (!hasTrimRange) {
          return clip.videoUrl;
        }
        return trimVideoClipToS3({
          sourceUrl: clip.videoUrl,
          trimStart: start,
          trimEnd: end,
          projectId: projectId || "unknown-project",
          storyboardId,
          clipIndex,
          sceneNumber: clip.sceneNumber,
        });
      }),
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to trim clips before merge" },
      { status: 502 },
    );
  }

  const mergeRes = await fetch(FAL_MERGE_URL, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({
      // Official ffmpeg-api/merge-videos contract expects an array of URL strings.
      video_urls: clipsForMerge,
    }),
  });

  if (!mergeRes.ok) {
    const text = await mergeRes.text();
    return NextResponse.json(
      { error: `Fal merge request failed: ${mergeRes.status} ${text}` },
      { status: 502 },
    );
  }

  const mergeJson = await mergeRes.json();
  let mergedVideoUrl = getMergedVideoUrlFromFalResponse(mergeJson);

  // Backward compatibility: handle queue-style responses that return response_url.
  if (!mergedVideoUrl) {
    const responseUrl = String(mergeJson?.response_url ?? "").trim();
    if (responseUrl) {
      let final: any;
      try {
        final = await pollFalResponse(responseUrl);
      } catch (err: any) {
        return NextResponse.json(
          { error: err?.message ?? "Fal merge polling failed" },
          { status: 502 },
        );
      }
      mergedVideoUrl = getMergedVideoUrlFromFalResponse(final);
    }
  }

  if (!mergedVideoUrl) {
    return NextResponse.json(
      { error: "Fal merge completed but returned no output URL" },
      { status: 502 },
    );
  }

  if (storyboard.script?.id) {
    await prisma.script.update({
      where: { id: storyboard.script.id },
      data: { mergedVideoUrl },
    });
  }

  return NextResponse.json({
    ok: true,
    mergedVideoUrl,
    clipsUsed: videoUrls.length,
  });
}
