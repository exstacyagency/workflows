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
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaKey = useMemo(
    () => script.upscaledVideoUrl ?? script.mergedVideoUrl ?? null,
    [script.upscaledVideoUrl, script.mergedVideoUrl]
  );

  useEffect(() => {
    if (!mediaKey) {
      setSignedUrl(null);
      setFallbackKey(null);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/media?key=${encodeURIComponent(mediaKey)}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch media");
        }
        const data = await res.json();
        const url: unknown = data?.url;
        if (typeof url !== "string") {
          throw new Error("Invalid media response");
        }

        if (cancelled) return;
        if (url.startsWith("http")) {
          setSignedUrl(url);
          setFallbackKey(null);
        } else {
          setSignedUrl(null);
          setFallbackKey(mediaKey);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Unable to load media");
          setSignedUrl(null);
          setFallbackKey(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [mediaKey]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="font-semibold text-slate-200">
          Script #{script.id.slice(0, 6)}
        </span>
        <span>{new Date(script.createdAt).toLocaleString()}</span>
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
      ) : loading ? (
        <p className="text-xs text-slate-500">Loading media preview…</p>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : signedUrl ? (
        <video
          src={signedUrl}
          controls
          className="w-full rounded-lg border border-slate-800 bg-black"
          preload="metadata"
        />
      ) : fallbackKey ? (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-300/30 rounded-md p-3 space-y-1">
          <p className="font-semibold">Media not configured (S3 not set)</p>
          <p className="font-mono text-amber-200 break-all">{fallbackKey}</p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Media unavailable. Try again shortly.
        </p>
      )}
    </div>
  );
}
