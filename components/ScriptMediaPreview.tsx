"use client";

import { useEffect, useMemo, useState } from "react";

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
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="font-semibold text-slate-200">
          Script #{script.id.slice(0, 6)}
        </span>
        <span suppressHydrationWarning>{displayTime}</span>
      </div>
      <p className="text-xs text-slate-400">
        Status: <span className="text-slate-200">{script.status ?? "pending"}</span>
        {typeof script.wordCount === "number" && (
          <span className="ml-2 text-slate-500">· {script.wordCount} words</span>
        )}
      </p>

      {!mediaKey ? (
        <p className="text-xs text-slate-500">
          No merged video available for this script yet.
        </p>
      ) : (
        <button
          type="button"
          onClick={handleGetVideo}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700"
        >
          {loading ? "Fetching link…" : "Get video link"}
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {warning && (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-300/30 rounded-md p-3 space-y-1">
          <p className="font-semibold">{warning}</p>
          {warningKey && (
            <p className="font-mono text-amber-200 break-all">{warningKey}</p>
          )}
        </div>
      )}
    </div>
  );
}
