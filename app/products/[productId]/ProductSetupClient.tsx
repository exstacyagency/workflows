"use client";

import Link from "next/link";
import { useState } from "react";

export type ProductSetupData = {
  id: string;
  name: string;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  soraCharacterId: string | null;
  characterCameoCreatedAt: string | null;
  project: {
    id: string;
    name: string;
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

export function ProductSetupClient({ product }: { product: ProductSetupData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateReferenceVideo() {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/character-video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractError(data, "Failed to start reference video job"));
      }
      window.setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCreateCharacter() {
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/character-cameo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractError(data, "Failed to start character cameo job"));
      }
      window.setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsCreating(false);
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
              Prepare your Sora character before running creative generation.
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
        <h2 className="text-sm font-semibold text-slate-100">Reference Images</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-xs text-slate-400 mb-2">Creator Reference</p>
            {product.creatorReferenceImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.creatorReferenceImageUrl}
                alt="Creator reference"
                className="h-48 w-full rounded border border-slate-700 object-cover"
              />
            ) : (
              <p className="text-xs text-slate-500">Not uploaded</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-xs text-slate-400 mb-2">Product Reference</p>
            {product.productReferenceImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.productReferenceImageUrl}
                alt="Product reference"
                className="h-48 w-full rounded border border-slate-700 object-cover"
              />
            ) : (
              <p className="text-xs text-slate-500">Not uploaded</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">Sora Character</h2>

        {!product.soraCharacterId ? (
          <div className="space-y-4">
            {!product.characterReferenceVideoUrl ? (
              <>
                <p className="text-sm text-slate-400">
                  Generate a short reference video from the creator image, then create your Sora character.
                </p>
                <button
                  type="button"
                  onClick={() => void handleGenerateReferenceVideo()}
                  disabled={isGenerating || !product.creatorReferenceImageUrl}
                  className="inline-flex items-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                >
                  {isGenerating ? "Generating..." : "Generate Reference Video"}
                </button>
              </>
            ) : (
              <>
                <video
                  src={product.characterReferenceVideoUrl}
                  controls
                  className="w-full max-w-lg rounded border border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCharacter()}
                  disabled={isCreating}
                  className="inline-flex items-center rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                >
                  {isCreating ? "Creating..." : "Create Sora Character"}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300">Character Ready</p>
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">ID:</span>{" "}
              <code className="rounded bg-slate-800 px-2 py-1">{product.soraCharacterId}</code>
            </p>
            {product.characterCameoCreatedAt && (
              <p className="text-xs text-slate-500">
                Created {new Date(product.characterCameoCreatedAt).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={isResetting}
              className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60"
            >
              {isResetting ? "Resetting..." : "Reset Character"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
