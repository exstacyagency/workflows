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
        <span style={{ fontSize: 10, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
          {clip.trimStart.toFixed(2)}s
        </span>
        <span style={{ fontSize: 10, color: "#f59e0b", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          {(clip.trimEnd - clip.trimStart).toFixed(2)}s kept
        </span>
        <span style={{ fontSize: 10, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
          {clip.trimEnd.toFixed(2)}s
        </span>
      </div>

      <div
        ref={railRef}
        onClick={handleRailClick}
        style={{
          position: "relative",
          height: 40,
          background: "#0d1117",
          borderRadius: 6,
          border: "1px solid #1f2937",
          cursor: "crosshair",
          overflow: "visible",
        }}
      >
        <div style={{
          position: "absolute",
          inset: 0,
          borderRadius: 5,
          background: "repeating-linear-gradient(90deg, #111827 0px, #111827 2px, #0d1117 2px, #0d1117 10px)",
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
          border: "2px solid #f59e0b", borderLeft: "none", borderRight: "none",
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
            width: 11, height: "100%", background: "#f59e0b",
            borderRadius: "4px 0 0 4px", display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <div style={{ width: 1.5, height: 14, background: "#92400e", borderRadius: 1 }} />
            <div style={{ width: 1.5, height: 14, background: "#92400e", borderRadius: 1 }} />
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
            width: 11, height: "100%", background: "#f59e0b",
            borderRadius: "0 4px 4px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <div style={{ width: 1.5, height: 14, background: "#92400e", borderRadius: 1 }} />
            <div style={{ width: 1.5, height: 14, background: "#92400e", borderRadius: 1 }} />
          </div>
        </div>

        {/* Playhead */}
        <div
          onMouseDown={(e) => handleMouseDown(e, "playhead")}
          style={{
            position: "absolute", left: `${toPercent(clampedTime)}%`,
            top: -5, bottom: -5, width: 2, background: "#ffffff",
            transform: "translateX(-1px)", zIndex: 20, cursor: "col-resize",
          }}
        >
          <div style={{
            position: "absolute", top: 3, left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: 7, height: 7, background: "#ffffff", borderRadius: 1,
          }} />
        </div>
      </div>

      <div style={{ position: "relative", height: 18, marginTop: 3 }}>
        {Array.from({ length: tickCount }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", left: `${(i / clip.durationSec) * 100}%`,
            transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <div style={{ width: 1, height: i % 2 === 0 ? 5 : 3, background: "#374151" }} />
            {i % 2 === 0 && (
              <span style={{ fontSize: 9, color: "#4b5563", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
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
            border: "1px solid #374151", borderRadius: 4,
            color: "#6b7280", fontSize: 10, cursor: "pointer",
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

  const activeClip = clips.find((c) => c.sceneId === activeSceneId) ?? null;
  const includedClips = clips.filter((c) => c.included);
  const totalTrimmedDuration = includedClips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart), 0);

  // Restore persisted edit state whenever storyboard/scene set changes.
  useEffect(() => {
    if (defaultClips.length === 0) {
      persistenceHydratedRef.current = false;
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
  }, [defaultClips, storageKey, sceneSignature]);

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
  }, [activeSceneId]);

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

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "196px 1fr 236px",
      gap: 16,
      height: "100%",
      minHeight: 600,
    }}>

      {/* ── LEFT RAIL ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          color: "#4b5563", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2,
        }}>
          Select a clip to edit
        </div>

        {clips.map((clip, index) => {
          const isActive = activeSceneId === clip.sceneId;
          const isTrimmed = clip.trimStart > 0 || clip.trimEnd < clip.durationSec;

          return (
            <button
              key={clip.sceneId}
              onClick={() => setActiveSceneId(clip.sceneId)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 7,
                border: `2px solid ${isActive ? "#3b82f6" : "#1f2937"}`,
                background: isActive ? "#0e1e36" : "#0d1117",
                cursor: "pointer",
                transition: "border-color 0.12s, background 0.12s",
                position: "relative",
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div style={{
                  position: "absolute", left: 0, top: "15%", bottom: "15%",
                  width: 3, background: "#3b82f6", borderRadius: "0 2px 2px 0",
                }} />
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                  background: isActive ? "#1d4ed8" : "#1a2030",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  color: isActive ? "#fff" : "#6b7280",
                }}>
                  {index + 1}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: isActive ? "#e5e7eb" : "#9ca3af",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  flex: 1, minWidth: 0,
                }}>
                  {clip.beatLabel || `Scene ${clip.sceneNumber}`}
                </span>
              </div>

              <div style={{
                fontSize: 10, color: "#4b5563",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                paddingLeft: 28,
              }}>
                {clip.vo}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, paddingLeft: 28 }}>
                <span style={{ fontSize: 10, color: isTrimmed ? "#f59e0b" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                  {isTrimmed
                    ? `${(clip.trimEnd - clip.trimStart).toFixed(1)}s / ${clip.durationSec}s`
                    : `${clip.durationSec}s`}
                </span>
                {isTrimmed && (
                  <span style={{ fontSize: 8, color: "#d97706", fontWeight: 700 }}>TRIMMED</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── CENTER: PLAYER + SCRUBBER ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {activeClip ? (
          <>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{
                position: "relative",
                aspectRatio: "9/16",
                width: "calc(440px * 9 / 16)",
                maxHeight: 440,
                borderRadius: 12,
                overflow: "hidden",
                background: "#000",
                border: "1px solid #1f2937",
                boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              }}>
                <video
                  ref={videoRef}
                  key={activeClip.sceneId}
                  src={activeClip.videoUrl}
                  playsInline
                  controls
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
                <div style={{
                  position: "absolute", top: 10, left: 10,
                  padding: "3px 8px", background: "rgba(0,0,0,0.65)",
                  borderRadius: 5, fontSize: 11, color: "#e5e7eb", fontWeight: 600,
                  backdropFilter: "blur(4px)", pointerEvents: "none",
                }}>
                  {activeClip.beatLabel || `Scene ${activeClip.sceneNumber}`}
                </div>
              </div>
            </div>

            {/* Scrubber */}
            <div style={{
              padding: "14px 16px 10px",
              background: "#0a0d14",
              borderRadius: 10,
              border: "1px solid #1a2030",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  ✂ Trim
                </span>
                <span style={{ fontSize: 10, color: "#374151", fontVariantNumeric: "tabular-nums" }}>
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
              <div style={{
                padding: "9px 13px", background: "#0d1117",
                border: "1px solid #1a2030", borderRadius: 7,
                fontSize: 11, color: "#4b5563", lineHeight: 1.5, fontStyle: "italic",
              }}>
                "{activeClip.vo}"
              </div>
            )}
          </>
        ) : (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px dashed #1a2030", borderRadius: 12, color: "#374151", fontSize: 13,
          }}>
            Select a clip from the left to edit
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        {activeClip && (
          <div style={{ padding: "12px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #1a2030" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#374151", textTransform: "uppercase", marginBottom: 8 }}>
              Active Clip
            </div>
            <div style={{ fontSize: 12, color: "#e5e7eb", fontWeight: 600, marginBottom: 10 }}>
              {activeClip.beatLabel || `Scene ${activeClip.sceneNumber}`}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ background: "#111827", borderRadius: 5, padding: "6px 8px" }}>
                <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Full</div>
                <div style={{ fontSize: 13, color: "#9ca3af", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {activeClip.durationSec}s
                </div>
              </div>
              <div style={{ background: "#111827", borderRadius: 5, padding: "6px 8px" }}>
                <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Kept</div>
                <div style={{ fontSize: 13, color: "#f59e0b", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {(activeClip.trimEnd - activeClip.trimStart).toFixed(1)}s
                </div>
              </div>
            </div>
            <button
              onClick={() => toggleIncluded(activeClip.sceneId)}
              style={{
                marginTop: 10, width: "100%", padding: "7px 0", borderRadius: 6,
                border: `1px solid ${activeClip.included ? "#166534" : "#374151"}`,
                background: activeClip.included ? "#052e16" : "transparent",
                color: activeClip.included ? "#4ade80" : "#6b7280",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {activeClip.included ? "✓ Included in merge" : "✕ Excluded — click to add"}
            </button>
          </div>
        )}

        <div style={{ padding: "12px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #1a2030", fontSize: 12, color: "#6b7280" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#374151", textTransform: "uppercase", marginBottom: 10 }}>
            Export Summary
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Clips included</span>
            <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{includedClips.length} / {clips.length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Est. duration</span>
            <span style={{ color: "#e5e7eb", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {totalTrimmedDuration.toFixed(1)}s
            </span>
          </div>
        </div>

        {error && (
          <div style={{ padding: "10px 12px", background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 8, color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}

        {mergedUrl && (
          <div style={{ padding: "12px 14px", background: "#052e16", border: "1px solid #166534", borderRadius: 8, fontSize: 12, color: "#4ade80" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>✓ Merged successfully</div>
            <a
              href={mergedUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              style={{
                display: "block", padding: "8px 0", background: "#16a34a",
                color: "#fff", borderRadius: 6, textDecoration: "none",
                fontSize: 12, fontWeight: 600, textAlign: "center",
              }}
            >
              ↓ Export Merged Video
            </a>
          </div>
        )}

        <button
          onClick={handleMerge}
          disabled={merging || includedClips.length === 0}
          style={{
            padding: "13px 0", borderRadius: 8,
            background: merging ? "#1f2937" : includedClips.length === 0 ? "#0d1117" : "#2563eb",
            border: `1px solid ${merging || includedClips.length === 0 ? "#1f2937" : "#3b82f6"}`,
            color: includedClips.length === 0 ? "#374151" : "#fff",
            fontSize: 14, fontWeight: 700,
            cursor: merging || includedClips.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {merging ? "Merging…" : mergedUrl ? "Re-merge" : "Merge Video"}
        </button>

        {includedClips.length === 0 && (
          <div style={{ fontSize: 11, color: "#374151", textAlign: "center" }}>
            Include at least one clip to merge
          </div>
        )}
      </div>
    </div>
  );
}
