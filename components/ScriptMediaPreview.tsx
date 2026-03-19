"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, SectionCard, StatusChip } from "@/components/ui";

export type ScriptMedia = {
  id: string;
  status: string | null;
  createdAt: string;
  mergedVideoUrl: string | null;
  upscaledVideoUrl: string | null;
  wordCount: number | null;
};

type Props = {
  script: ScriptMedia;
};

export function ScriptMediaPreview({ script }: Props) {
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [warningKey, setWarningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayTime, setDisplayTime] = useState<string>("");

  const mediaKey = useMemo(
    () => script.upscaledVideoUrl ?? script.mergedVideoUrl ?? null,
    [script.upscaledVideoUrl, script.mergedVideoUrl]
  );

  const updatedAt = script.createdAt;
  useEffect(() => {
    try {
      setDisplayTime(new Date(updatedAt).toLocaleString());
    } catch {
      setDisplayTime("");
    }
  }, [updatedAt]);

  async function handleGetVideo() {
    if (!mediaKey || loading) return;
    setLoading(true);
    setWarning(null);
    setWarningKey(null);
    setError(null);

    try {
      const res = await fetch(`/api/media?key=${encodeURIComponent(mediaKey)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch media");
      }
      const data = await res.json();
      const url: unknown = data?.url;
      if (typeof url !== "string") {
        throw new Error("Invalid media response");
      }

      if (url.startsWith("http")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        setWarning("Media not configured (S3 not set)");
        setWarningKey(mediaKey);
      }
    } catch (err: any) {
      setError(err?.message ?? "Unable to fetch video link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-body-sm text-muted font-mono">
        <span className="font-semibold text-text">
          Script #{script.id.slice(0, 6)}
        </span>
        <span suppressHydrationWarning className="opacity-70">{displayTime}</span>
      </div>
      <p className="text-xs text-muted">
        Status: <StatusChip variant="info" className="ml-2 !px-2 !py-0.5 !text-label-xs">{script.status ?? "pending"}</StatusChip>
        {typeof script.wordCount === "number" && (
          <span className="ml-2 opacity-50 font-mono">· {script.wordCount} words</span>
        )}
      </p>

      {!mediaKey ? (
        <EmptyState
          title="No merged video available"
          description="No merged video is available for this script yet."
        />
      ) : (
        <button
          type="button"
          onClick={handleGetVideo}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-inner bg-bg-elevated hover:bg-panel-strong disabled:opacity-50 border border-line text-muted hover:text-white font-mono transition-all"
        >
          {loading ? "Fetching link…" : "Get video link"}
        </button>
      )}
      {error && <p className="text-xs text-accent">{error}</p>}
      {warning && (
        <SectionCard padding="sm" className="text-body-sm text-accent bg-accent/5 border-accent/20 space-y-2">
          <p className="font-bold uppercase tracking-tight opacity-90">{warning}</p>
          {warningKey && (
            <p className="font-mono text-accent break-all leading-relaxed">{warningKey}</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
