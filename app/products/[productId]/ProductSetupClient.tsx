"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ProductSetupData = {
  id: string;
  name: string;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  characterCameoCreatedAt: string | null;
  creatorVisualPrompt: string | null;
  characterSeedVideoTaskId: string | null;
  characterSeedVideoUrl: string | null;
  characterUserName: string | null;
  characters: {
    id: string;
    name: string;
    characterUserName: string | null;
    soraCharacterId: string | null;
    seedVideoUrl: string | null;
    createdAt: string;
  }[];
  project: {
    id: string;
    name: string;
  };
};

type StageStatus = {
  type: string;
  label: string;
  jobId: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CharacterPipelineStatusResponse = {
  productId: string;
  projectId: string;
  isComplete: boolean;
  activeStage: string | null;
  stages: StageStatus[];
  character: {
    soraCharacterId: string | null;
    characterUserName: string | null;
    characterReferenceVideoUrl: string | null;
    characterCameoCreatedAt: string | null;
  };
};

function extractError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  return fallback;
}

function prettyStatus(status: StageStatus["status"]): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Running";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function stageStatusText(stage: StageStatus): string {
  if (!stage.jobId) return "Not started";
  return prettyStatus(stage.status);
}

export function ProductSetupClient({ product }: { product: ProductSetupData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [manualDescription, setManualDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<CharacterPipelineStatusResponse | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await fetch(
      `/api/jobs/character-generation/status?productId=${encodeURIComponent(product.id)}`,
      { cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(extractError(data, "Failed to fetch character pipeline status"));
    }
    setPipelineStatus(data as CharacterPipelineStatusResponse);
    return data as CharacterPipelineStatusResponse;
  }, [product.id]);

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        await refreshStatus();
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load status");
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 4000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (pipelineStatus?.isComplete && !product.soraCharacterId) {
      window.setTimeout(() => window.location.reload(), 1200);
    }
  }, [pipelineStatus?.isComplete, product.soraCharacterId]);

  const stages = useMemo(() => pipelineStatus?.stages ?? [], [pipelineStatus?.stages]);
  const hasInFlightStage = useMemo(
    () =>
      stages.some(
        (stage) => Boolean(stage.jobId) && (stage.status === "PENDING" || stage.status === "RUNNING"),
      ),
    [stages],
  );
  const hasFailedStage = useMemo(
    () => stages.some((stage) => stage.status === "FAILED"),
    [stages],
  );

  const effectiveCharacterId =
    pipelineStatus?.character?.soraCharacterId ?? product.soraCharacterId ?? null;
  const effectiveReferenceVideo =
    pipelineStatus?.character?.characterReferenceVideoUrl ??
    product.characterSeedVideoUrl ??
    product.characterReferenceVideoUrl;
  const effectiveCharacterUserName =
    pipelineStatus?.character?.characterUserName ?? product.characterUserName;
  const effectiveCameoCreatedAt =
    pipelineStatus?.character?.characterCameoCreatedAt ?? product.characterCameoCreatedAt;

  async function handleGenerateCharacter() {
    setIsGenerating(true);
    setError(null);

    try {
      if (!product.creatorReferenceImageUrl) {
        throw new Error("Creator reference image is required before generating a character.");
      }

      const res = await fetch("/api/jobs/character-generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          manualDescription: manualDescription.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractError(data, "Failed to start character generation"));
      }

      await refreshStatus();
      setManualDescription("");
      setAddingCharacter(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleReset() {
    if (!window.confirm("Delete character and start over?")) return;

    setIsResetting(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}/reset-character`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractError(data, "Failed to reset character"));
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Product Setup</p>
            <h1 className="text-2xl font-semibold text-slate-50">{product.name}</h1>
            <p className="text-sm text-slate-400 mt-1">
              Run the 3-stage character pipeline to create your reusable Sora character.
            </p>
          </div>
          <Link
            href={`/projects/${product.project.id}/products`}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Back to Products
          </Link>
        </div>
      </section>

      {error && (
        <section className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </section>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">Character Generation</h2>

        {!effectiveCharacterId ? (
          <>
            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(event) => setManualMode(event.target.checked)}
                />
                Manual description
              </label>
              {manualMode && (
                <textarea
                  value={manualDescription}
                  onChange={(event) => setManualDescription(event.target.value)}
                  placeholder="Describe the creator visual style for a 10s UGC seed video..."
                  className="min-h-[96px] w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              )}
              <button
                type="button"
                onClick={() => void handleGenerateCharacter()}
                disabled={
                  isGenerating ||
                  hasInFlightStage ||
                  !product.creatorReferenceImageUrl ||
                  (manualMode && manualDescription.trim().length === 0)
                }
                className="inline-flex items-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
              >
                {isGenerating ? "Starting..." : "Generate Character"}
              </button>
              {!product.creatorReferenceImageUrl && (
                <p className="text-xs text-amber-300">
                  Add a creator reference image first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              {stages.length === 0 ? (
                <p className="text-xs text-slate-500">No pipeline jobs yet.</p>
              ) : (
                stages.map((stage) => (
                  <div
                    key={stage.type}
                    className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-slate-200">{stage.label}</p>
                      <p
                        className={`text-xs ${
                          stage.status === "COMPLETED"
                            ? "text-emerald-300"
                            : stage.status === "FAILED"
                              ? "text-red-300"
                              : stage.status === "RUNNING"
                                ? "text-sky-300"
                                : "text-slate-400"
                        }`}
                      >
                        {stageStatusText(stage)}
                      </p>
                    </div>
                    {stage.error && <p className="mt-2 text-xs text-red-300">{stage.error}</p>}
                  </div>
                ))
              )}
            </div>

            {hasFailedStage && (
              <p className="text-xs text-amber-300">
                A stage failed. Reset and rerun, or retry after fixing configuration.
              </p>
            )}
          </>
        ) : (
          <>
            {effectiveCharacterId && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-emerald-300">
                    {product.characters.length} Character{product.characters.length !== 1 ? "s" : ""} Ready
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingCharacter((v) => !v)}
                      className="inline-flex items-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white"
                    >
                      + Add Character
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReset()}
                      disabled={isResetting}
                      className="inline-flex items-center rounded-md border border-red-800 bg-red-950 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-900 disabled:opacity-60"
                    >
                      {isResetting ? "Resetting..." : "Reset All"}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {product.characters.map((char) => (
                    <div key={char.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-100">{char.name}</p>
                        <p className="text-xs text-slate-500">{new Date(char.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="text-xs text-slate-400">
                        <span className="text-slate-500">Handle:</span> @{char.characterUserName}
                      </p>
                      <p className="text-xs text-slate-500">
                        <span className="text-slate-600">ID:</span>{" "}
                        <code className="rounded bg-slate-800 px-1">{char.soraCharacterId}</code>
                      </p>
                      {char.seedVideoUrl && (
                        <video
                          src={char.seedVideoUrl}
                          controls
                          className="w-full max-w-lg rounded border border-slate-700"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {addingCharacter && (
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                    <p className="text-xs text-slate-400">
                      Generate an additional character for this product.
                    </p>
                    <textarea
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      placeholder="Describe this character&apos;s visual style..."
                      className="min-h-[96px] w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleGenerateCharacter()}
                        disabled={
                          isGenerating ||
                          hasInFlightStage ||
                          manualDescription.trim().length === 0
                        }
                        className="inline-flex items-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                      >
                        {isGenerating ? "Starting..." : "Generate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingCharacter(false)}
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                    {hasInFlightStage && (
                      <p className="text-xs text-amber-300">Pipeline already running - wait for it to finish.</p>
                    )}
                  </div>
                )}

                {hasInFlightStage && stages.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {stages.map((stage) => (
                      <div key={stage.type} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-slate-200">{stage.label}</p>
                          <p
                            className={`text-xs ${
                              stage.status === "COMPLETED"
                                ? "text-emerald-300"
                                : stage.status === "FAILED"
                                  ? "text-red-300"
                                  : stage.status === "RUNNING"
                                    ? "text-sky-300"
                                    : "text-slate-400"
                            }`}
                          >
                            {stageStatusText(stage)}
                          </p>
                        </div>
                        {stage.error && <p className="mt-2 text-xs text-red-300">{stage.error}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
