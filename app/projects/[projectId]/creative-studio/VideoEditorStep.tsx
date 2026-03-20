"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";

type SceneClip = {
  sceneId: string;
  sceneNumber: number;
  videoUrl: string;
  beatLabel: string;
  vo: string;
  durationSec: number;
  included: boolean;
  trimStart: number;
  trimEnd: number;
};

type Props = {
  storyboardId: string;
  projectId: string;
  scenes: Array<{
    sceneId: string;
    sceneNumber: number;
    videoUrl: string | null;
    videoVersionToken?: string | number | null;
    beatLabel: string;
    vo: string;
    durationSec?: number;
  }>;
  onComplete?: (mergedVideoUrl: string) => void;
};

type PersistedClipState = {
  sceneId: string;
  sceneNumber: number;
  included: boolean;
  trimStart: number;
  trimEnd: number;
};

type PersistedVideoEditorState = {
  version: 1;
  activeSceneId: string | null;
  clips: PersistedClipState[];
};

const VIDEO_EDITOR_STORAGE_VERSION = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildDefaultClips(scenes: Props["scenes"]): SceneClip[] {
  return scenes
    .filter((s) => Boolean(s.videoUrl))
    .map((s) => ({
      sceneId: s.sceneId,
      sceneNumber: s.sceneNumber,
      videoUrl: s.videoUrl!,
      beatLabel: s.beatLabel,
      vo: s.vo,
      durationSec: s.durationSec ?? 8,
      included: true,
      trimStart: 0,
      trimEnd: s.durationSec ?? 8,
    }));
}

function appendVideoVersionToken(url: string, versionToken?: string | number | null): string {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) return "";
  if (versionToken === null || versionToken === undefined || versionToken === "") {
    return normalizedUrl;
  }

  const separator = normalizedUrl.includes("?") ? "&" : "?";
  return `${normalizedUrl}${separator}v=${encodeURIComponent(String(versionToken))}`;
}

function TrimScrubber({
  clip,
  currentTime,
  onSeek,
  onTrimChange,
}: {
  clip: SceneClip;
  currentTime: number;
  onSeek: (t: number) => void;
  onTrimChange: (start: number, end: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "playhead" | null>(null);

  const toPercent = (t: number) => (t / clip.durationSec) * 100;
  const clampedTime = Math.max(clip.trimStart, Math.min(clip.trimEnd, currentTime));

  const getTimeFromEvent = (e: MouseEvent | React.MouseEvent) => {
    if (!railRef.current) return 0;
    const rect = railRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * clip.durationSec;
  };

  const handleMouseDown = (e: React.MouseEvent, handle: "start" | "end" | "playhead") => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = handle;

    const onMove = (ev: MouseEvent) => {
      const t = getTimeFromEvent(ev);
      if (dragging.current === "start") {
        const newStart = Math.max(0, Math.min(t, clip.trimEnd - 0.1));
        onTrimChange(newStart, clip.trimEnd);
        onSeek(newStart);
      } else if (dragging.current === "end") {
        const newEnd = Math.max(clip.trimStart + 0.1, Math.min(t, clip.durationSec));
        onTrimChange(clip.trimStart, newEnd);
        onSeek(newEnd);
      } else {
        const clamped = Math.max(clip.trimStart, Math.min(clip.trimEnd, t));
        onSeek(clamped);
      }
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleRailClick = (e: React.MouseEvent) => {
    if (dragging.current) return;
    const t = getTimeFromEvent(e);
    const clamped = Math.max(clip.trimStart, Math.min(clip.trimEnd, t));
    onSeek(clamped);
  };

  const tickCount = Math.floor(clip.durationSec) + 1;

  return (
    <div style={{ padding: "0 2px", userSelect: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "rgb(107, 114, 128)", fontVariantNumeric: "tabular-nums" }}>
          {clip.trimStart.toFixed(2)}s
        </span>
        <span style={{ fontSize: 10, color: "rgb(245, 158, 11)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          {(clip.trimEnd - clip.trimStart).toFixed(2)}s kept
        </span>
        <span style={{ fontSize: 10, color: "rgb(107, 114, 128)", fontVariantNumeric: "tabular-nums" }}>
          {clip.trimEnd.toFixed(2)}s
        </span>
      </div>

      <div
        ref={railRef}
        onClick={handleRailClick}
        style={{
          position: "relative",
          height: 40,
          background: "rgb(13, 17, 23)",
          borderRadius: 6,
          border: "1px solid rgb(31, 41, 55)",
          cursor: "crosshair",
          overflow: "visible",
        }}
      >
        <div style={{
          position: "absolute",
          inset: 0,
          borderRadius: 5,
          background: "repeating-linear-gradient(90deg, rgb(17, 24, 39) 0px, rgb(17, 24, 39) 2px, rgb(13, 17, 23) 2px, rgb(13, 17, 23) 10px)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${toPercent(clip.trimStart)}%`,
          background: "rgba(0,0,0,0.7)", borderRadius: "5px 0 0 5px",
          zIndex: 1, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0,
          width: `${100 - toPercent(clip.trimEnd)}%`,
          background: "rgba(0,0,0,0.7)", borderRadius: "0 5px 5px 0",
          zIndex: 1, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          left: `${toPercent(clip.trimStart)}%`,
          width: `${toPercent(clip.trimEnd) - toPercent(clip.trimStart)}%`,
          top: 0, bottom: 0,
          border: "2px solid rgb(245, 158, 11)", borderLeft: "none", borderRight: "none",
          background: "rgba(245, 158, 11, 0.07)",
          zIndex: 2, pointerEvents: "none",
        }} />

        {/* In-handle */}
        <div
          onMouseDown={(e) => handleMouseDown(e, "start")}
          style={{
            position: "absolute", left: `${toPercent(clip.trimStart)}%`,
            top: 0, bottom: 0, width: 16, transform: "translateX(-8px)",
            zIndex: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            width: 11, height: "100%", background: "rgb(245, 158, 11)",
            borderRadius: "4px 0 0 4px", display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <div style={{ width: 1.5, height: 14, background: "rgb(146, 64, 14)", borderRadius: 1 }} />
            <div style={{ width: 1.5, height: 14, background: "rgb(146, 64, 14)", borderRadius: 1 }} />
          </div>
        </div>

        {/* Out-handle */}
        <div
          onMouseDown={(e) => handleMouseDown(e, "end")}
          style={{
            position: "absolute", left: `${toPercent(clip.trimEnd)}%`,
            top: 0, bottom: 0, width: 16, transform: "translateX(-8px)",
            zIndex: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            width: 11, height: "100%", background: "rgb(245, 158, 11)",
            borderRadius: "0 4px 4px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <div style={{ width: 1.5, height: 14, background: "rgb(146, 64, 14)", borderRadius: 1 }} />
            <div style={{ width: 1.5, height: 14, background: "rgb(146, 64, 14)", borderRadius: 1 }} />
          </div>
        </div>

        {/* Playhead */}
        <div
          onMouseDown={(e) => handleMouseDown(e, "playhead")}
          style={{
            position: "absolute", left: `${toPercent(clampedTime)}%`,
            top: -5, bottom: -5, width: 2, background: "rgb(255, 255, 255)",
            transform: "translateX(-1px)", zIndex: 20, cursor: "col-resize",
          }}
        >
          <div style={{
            position: "absolute", top: 3, left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: 7, height: 7, background: "rgb(255, 255, 255)", borderRadius: 1,
          }} />
        </div>
      </div>

      <div style={{ position: "relative", height: 18, marginTop: 3 }}>
        {Array.from({ length: tickCount }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", left: `${(i / clip.durationSec) * 100}%`,
            transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <div style={{ width: 1, height: i % 2 === 0 ? 5 : 3, background: "rgb(55, 65, 81)" }} />
            {i % 2 === 0 && (
              <span style={{ fontSize: 9, color: "rgb(75, 85, 99)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                {i}s
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button
          onClick={() => onTrimChange(0, clip.durationSec)}
          style={{
            padding: "3px 8px", background: "transparent",
            border: "1px solid rgb(55, 65, 81)", borderRadius: 4,
            color: "rgb(107, 114, 128)", fontSize: 10, cursor: "pointer",
          }}
        >
          Reset trim
        </button>
      </div>
    </div>
  );
}

export function VideoEditorStep({ storyboardId, projectId, scenes, onComplete }: Props) {
  const storageKey = `video-editor:${projectId}:${storyboardId}`;
  const sceneSignature = useMemo(
    () =>
      scenes
        .map((s) => `${s.sceneId}:${s.videoUrl ?? ""}:${s.durationSec ?? 8}`)
        .join("|"),
    [scenes],
  );
  const defaultClips = useMemo(() => buildDefaultClips(scenes), [sceneSignature, scenes]);

  const [clips, setClips] = useState<SceneClip[]>(defaultClips);

  // Only one clip selected at a time — starts on first clip
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    defaultClips[0]?.sceneId ?? null
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [merging, setMerging] = useState(false);
  const [mergedUrl, setMergedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const persistenceHydratedRef = useRef(false);
  const hydratedStorageKeyRef = useRef<string | null>(null);

  const activeClip = clips.find((c) => c.sceneId === activeSceneId) ?? null;
  const activeSceneMeta = scenes.find((scene) => scene.sceneId === activeSceneId) ?? null;
  const activeClipPlaybackUrl = activeClip
    ? appendVideoVersionToken(activeClip.videoUrl, activeSceneMeta?.videoVersionToken)
    : "";
  const includedClips = clips.filter((c) => c.included);
  const totalTrimmedDuration = includedClips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart), 0);

  // Restore persisted edit state once per storyboard key.
  // Subsequent scene refreshes preserve current in-memory edits and only reconcile new/removed clips.
  useEffect(() => {
    if (defaultClips.length === 0) {
      persistenceHydratedRef.current = false;
      hydratedStorageKeyRef.current = null;
      return;
    }

    const alreadyHydratedForKey = hydratedStorageKeyRef.current === storageKey;
    if (alreadyHydratedForKey) {
      setClips((prev) => {
        const bySceneId = new Map(prev.map((clip) => [clip.sceneId, clip] as const));
        const bySceneNumber = new Map(prev.map((clip) => [clip.sceneNumber, clip] as const));
        return defaultClips.map((clip) => {
          const existing = bySceneId.get(clip.sceneId) ?? bySceneNumber.get(clip.sceneNumber);
          if (!existing) return clip;
          const maxStart = Math.max(0, clip.durationSec - 0.1);
          const trimStart = clamp(existing.trimStart, 0, maxStart);
          const trimEnd = clamp(existing.trimEnd, Math.min(clip.durationSec, trimStart + 0.1), clip.durationSec);
          return {
            ...clip,
            included: existing.included,
            trimStart,
            trimEnd,
          };
        });
      });
      setActiveSceneId((prev) => {
        if (prev && defaultClips.some((clip) => clip.sceneId === prev)) return prev;
        return defaultClips[0]?.sceneId ?? null;
      });
      return;
    }

    const fallbackClips = defaultClips;
    let nextClips = fallbackClips;
    let nextActiveSceneId = fallbackClips[0]?.sceneId ?? null;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedVideoEditorState>;
        if (
          parsed &&
          parsed.version === VIDEO_EDITOR_STORAGE_VERSION &&
          Array.isArray(parsed.clips)
        ) {
          const persistedBySceneId = new Map<string, PersistedClipState>();
          const persistedBySceneNumber = new Map<number, PersistedClipState>();
          for (const clip of parsed.clips) {
            if (!clip || typeof clip.sceneId !== "string") continue;
            persistedBySceneId.set(clip.sceneId, clip);
            if (Number.isFinite(Number(clip.sceneNumber))) {
              persistedBySceneNumber.set(Number(clip.sceneNumber), clip);
            }
          }

          nextClips = fallbackClips.map((clip) => {
            const persisted =
              persistedBySceneId.get(clip.sceneId) ??
              persistedBySceneNumber.get(Number(clip.sceneNumber));
            if (!persisted) return clip;

            const maxStart = Math.max(0, clip.durationSec - 0.1);
            const persistedStart = Number.isFinite(Number(persisted.trimStart))
              ? Number(persisted.trimStart)
              : clip.trimStart;
            const trimStart = clamp(persistedStart, 0, maxStart);

            const persistedEnd = Number.isFinite(Number(persisted.trimEnd))
              ? Number(persisted.trimEnd)
              : clip.trimEnd;
            const trimEnd = clamp(
              persistedEnd,
              Math.min(clip.durationSec, trimStart + 0.1),
              clip.durationSec,
            );

            return {
              ...clip,
              included:
                typeof persisted.included === "boolean" ? persisted.included : clip.included,
              trimStart,
              trimEnd,
            };
          });

          const persistedActive = typeof parsed.activeSceneId === "string" ? parsed.activeSceneId : null;
          if (persistedActive && nextClips.some((clip) => clip.sceneId === persistedActive)) {
            nextActiveSceneId = persistedActive;
          }
        }
      }
    } catch {
      // Ignore invalid cache and use defaults.
    }

    setClips(nextClips);
    setActiveSceneId(nextActiveSceneId);
    const initialActiveClip = nextClips.find((clip) => clip.sceneId === nextActiveSceneId) ?? null;
    setCurrentTime(initialActiveClip?.trimStart ?? 0);
    persistenceHydratedRef.current = true;
    hydratedStorageKeyRef.current = storageKey;
  }, [defaultClips, storageKey]);

  // Persist edit state across reloads.
  useEffect(() => {
    if (!persistenceHydratedRef.current) return;
    if (clips.length === 0) return;

    try {
      const payload: PersistedVideoEditorState = {
        version: VIDEO_EDITOR_STORAGE_VERSION,
        activeSceneId,
        clips: clips.map((clip) => ({
          sceneId: clip.sceneId,
          sceneNumber: clip.sceneNumber,
          included: clip.included,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
        })),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage failures (private mode/quota/etc.).
    }
  }, [clips, activeSceneId, storageKey]);

  // When active clip changes, seek video to its trimStart
  useEffect(() => {
    const t = setTimeout(() => {
      if (videoRef.current && activeClip) {
        videoRef.current.currentTime = activeClip.trimStart;
        setCurrentTime(activeClip.trimStart);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [activeSceneId, activeClip?.trimStart, activeClipPlaybackUrl]);

  // Stop playback at trimEnd
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;
    const check = () => {
      if (vid.currentTime >= activeClip.trimEnd) {
        vid.pause();
        vid.currentTime = activeClip.trimStart;
      }
    };
    vid.addEventListener("timeupdate", check);
    return () => vid.removeEventListener("timeupdate", check);
  }, [activeSceneId, activeClip?.trimEnd, activeClip?.trimStart]);

  const handleSeek = (t: number) => {
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const handleTrimChange = (sceneId: string, start: number, end: number) => {
    setClips((prev) =>
      prev.map((c) => (c.sceneId === sceneId ? { ...c, trimStart: start, trimEnd: end } : c))
    );
  };

  const toggleIncluded = (sceneId: string) => {
    setClips((prev) =>
      prev.map((c) => (c.sceneId === sceneId ? { ...c, included: !c.included } : c))
    );
  };

  const handleMerge = useCallback(async () => {
    if (includedClips.length === 0) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch(`/api/storyboards/${storyboardId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clips: includedClips.map((c) => {
            const isTrimmed = c.trimStart > 0.001 || c.trimEnd < c.durationSec - 0.001;
            return {
              videoUrl: c.videoUrl,
              sceneNumber: c.sceneNumber,
              ...(isTrimmed ? { trimStart: c.trimStart, trimEnd: c.trimEnd } : {}),
            };
          }),
          videoUrls: includedClips.map((c) => c.videoUrl),
        }),
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error((data?.error ?? raw) || "Merge failed");
      }
      setMergedUrl(data.mergedVideoUrl);
      onComplete?.(data.mergedVideoUrl);
    } catch (err: any) {
      setError(err?.message ?? "Merge failed");
    } finally {
      setMerging(false);
    }
  }, [includedClips, storyboardId, projectId, onComplete]);

  const handleResetEdits = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures.
    }
    const resetClips = defaultClips;
    setClips(resetClips);
    const resetActiveSceneId = resetClips[0]?.sceneId ?? null;
    setActiveSceneId(resetActiveSceneId);
    setCurrentTime(resetClips[0]?.trimStart ?? 0);
    persistenceHydratedRef.current = true;
    hydratedStorageKeyRef.current = storageKey;
  }, [defaultClips, storageKey]);

  return (
    <div
      className="grid h-full min-h-[600px] gap-4 lg:grid-cols-[196px_minmax(0,1fr)_236px]"
    >

      {/* ── LEFT RAIL ── */}
      <div className="flex flex-col gap-2 overflow-y-auto rounded-card border border-line bg-panel p-3">
        <div className="pl-1 text-label font-bold uppercase tracking-widest text-muted">
          Select a clip to edit
        </div>

        {clips.map((clip, index) => {
          const isActive = activeSceneId === clip.sceneId;
          const isTrimmed = clip.trimStart > 0 || clip.trimEnd < clip.durationSec;

          return (
            <button
              key={clip.sceneId}
              onClick={() => setActiveSceneId(clip.sceneId)}
              className={`relative block w-full rounded-card border px-3 py-3 text-left transition-all ${
                isActive
                  ? "border-accent-2/50 bg-bg-elevated"
                  : "border-line bg-transparent hover:border-line/60"
              }`}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div
                  className="absolute bottom-[15%] left-0 top-[15%] w-[3px] rounded-r-sm bg-accent-2"
                />
              )}

              <div className="mb-1 flex items-center gap-2">
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px] text-label font-bold ${
                    isActive ? "bg-accent-2 text-bg" : "bg-bg-elevated text-muted"
                  }`}
                >
                  {index + 1}
                </div>
                <span
                  className={`min-w-0 flex-1 truncate text-body-xs font-semibold ${
                    isActive ? "text-white" : "text-muted"
                  }`}
                >
                  {clip.beatLabel || `Scene ${clip.sceneNumber}`}
                </span>
              </div>

              <div className="truncate pl-7 text-label text-muted">
                {clip.vo}
              </div>

              <div className="mt-1 flex justify-between pl-7">
                <span
                  className={`text-label tabular-nums ${
                    isTrimmed ? "text-accent" : "text-muted/40"
                  }`}
                >
                  {isTrimmed
                    ? `${(clip.trimEnd - clip.trimStart).toFixed(1)}s / ${clip.durationSec}s`
                    : `${clip.durationSec}s`}
                </span>
                {isTrimmed && (
                  <span className="text-label-xs font-bold uppercase tracking-widest text-accent">
                    Trimmed
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── CENTER: PLAYER + SCRUBBER ── */}
      <div className="flex min-w-0 flex-col gap-4">
        {activeClip ? (
          <>
            <div className="flex justify-center rounded-card border border-line bg-panel p-5">
              <div
                className="relative aspect-[9/16] w-[247px] max-h-[440px] overflow-hidden rounded-card border border-line bg-bg shadow-panel"
              >
                <video
                  ref={videoRef}
                  key={`${activeClip.sceneId}:${activeClipPlaybackUrl}`}
                  src={activeClipPlaybackUrl}
                  playsInline
                  controls
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
                <div
                  className="pointer-events-none absolute left-3 top-3 rounded-pill border border-line bg-panel px-3 py-1 text-label font-mono font-semibold uppercase tracking-widest text-white backdrop-blur-panel"
                >
                  {activeClip.beatLabel || `Scene ${activeClip.sceneNumber}`}
                </div>
              </div>
            </div>

            {/* Scrubber */}
            <div className="rounded-card border border-line bg-panel p-4">
              <div className="mb-3 flex justify-between">
                <span className="text-label font-bold uppercase tracking-widest text-muted">
                  ✂ Trim
                </span>
                <span className="text-label tabular-nums text-muted/40">
                  playhead {currentTime.toFixed(2)}s
                </span>
              </div>
              <TrimScrubber
                clip={activeClip}
                currentTime={currentTime}
                onSeek={handleSeek}
                onTrimChange={(start, end) => handleTrimChange(activeClip.sceneId, start, end)}
              />
            </div>

            {activeClip.vo && (
              <div className="rounded-card border border-line bg-panel px-4 py-3 text-body-sm italic leading-relaxed text-muted">
                &quot;{activeClip.vo}&quot;
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-line bg-panel p-10 text-sm text-muted">
            Select a clip from the left to edit
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex flex-col gap-4">

        {activeClip && (
          <div className="rounded-card border border-line bg-panel p-4">
            <div className="mb-2 text-label font-bold uppercase tracking-widest text-muted">
              Active Clip
            </div>
            <div className="mb-3 text-body-xs font-semibold text-white">
              {activeClip.beatLabel || `Scene ${activeClip.sceneNumber}`}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-card bg-bg-elevated px-3 py-2">
                <div className="mb-1 text-label-sm uppercase tracking-[0.06em] text-muted">Full</div>
                <div className="text-sm font-semibold tabular-nums text-muted">
                  {activeClip.durationSec}s
                </div>
              </div>
              <div className="rounded-card bg-bg-elevated px-3 py-2">
                <div className="mb-1 text-label-sm uppercase tracking-[0.06em] text-muted">Kept</div>
                <div className="text-sm font-semibold tabular-nums text-accent">
                  {(activeClip.trimEnd - activeClip.trimStart).toFixed(1)}s
                </div>
              </div>
            </div>
            <button
              onClick={() => toggleIncluded(activeClip.sceneId)}
              className={`mt-3 w-full rounded-pill border px-4 py-2 text-body-xs font-semibold transition-colors ${
                activeClip.included
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-line bg-transparent text-muted"
              }`}
            >
              {activeClip.included ? "✓ Included in merge" : "✕ Excluded — click to add"}
            </button>
          </div>
        )}

        <div className="rounded-card border border-line bg-panel p-4 text-body-xs text-muted">
          <div className="mb-3 text-label font-bold uppercase tracking-widest text-muted">
            Export Summary
          </div>
          <div className="mb-2 flex justify-between">
            <span>Clips included</span>
            <span className="font-semibold text-white">{includedClips.length} / {clips.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Est. duration</span>
            <span className="font-semibold tabular-nums text-white">
              {totalTrimmedDuration.toFixed(1)}s
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-body-xs text-danger">
            {error}
          </div>
        )}

        {mergedUrl && (
          <div className="rounded-card border border-success/30 bg-success/10 p-4 text-body-xs text-success">
            <div className="mb-2 font-semibold">✓ Merged successfully</div>
            <a
              href={mergedUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="block rounded-pill bg-[linear-gradient(135deg,var(--accent),#f4e9b5)] px-4 py-2 text-center text-body-xs font-semibold text-[#111] no-underline"
            >
              ↓ Export Merged Video
            </a>
          </div>
        )}

        <button
          onClick={handleMerge}
          disabled={merging || includedClips.length === 0}
          className={`btn !min-h-[44px] w-full text-sm font-bold ${
            merging || includedClips.length === 0 ? "btn-secondary opacity-50" : "btn-primary"
          }`}
        >
          {merging ? "Merging…" : mergedUrl ? "Re-merge" : "Merge Video"}
        </button>

        <button
          type="button"
          onClick={handleResetEdits}
          className="btn btn-secondary !min-h-[40px] w-full text-body-xs font-semibold"
        >
          Reset edits
        </button>

        {includedClips.length === 0 && (
          <div className="text-center text-body-sm text-muted">
            Include at least one clip to merge
          </div>
        )}
      </div>
    </div>
  );
}
