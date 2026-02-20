"use client";

import { FormEvent, useMemo, useState } from "react";

type ProjectSettingsPanelProps = {
  projectId: string;
  initialName: string;
  initialDescription: string | null;
  initialCreatorReferenceImageUrl: string | null;
  initialProductReferenceImageUrl: string | null;
};

type ReferenceKind = "creator" | "product";

function toNullableTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

function sanitizeImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const allowedProtocols = new Set(["http:", "https:"]);
    if (!allowedProtocols.has(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function ProjectSettingsPanel({
  projectId,
  initialName,
  initialDescription,
  initialCreatorReferenceImageUrl,
  initialProductReferenceImageUrl,
}: ProjectSettingsPanelProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [creatorReferenceImageUrl, setCreatorReferenceImageUrl] = useState(initialCreatorReferenceImageUrl ?? "");
  const [productReferenceImageUrl, setProductReferenceImageUrl] = useState(initialProductReferenceImageUrl ?? "");
  const [savedName, setSavedName] = useState(initialName);
  const [savedDescription, setSavedDescription] = useState(initialDescription ?? "");
  const [savedCreatorReferenceImageUrl, setSavedCreatorReferenceImageUrl] = useState(initialCreatorReferenceImageUrl ?? "");
  const [savedProductReferenceImageUrl, setSavedProductReferenceImageUrl] = useState(initialProductReferenceImageUrl ?? "");
  const [creatorFile, setCreatorFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<ReferenceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasPendingChanges = useMemo(() => {
    return (
      name !== savedName ||
      description !== savedDescription ||
      creatorReferenceImageUrl !== savedCreatorReferenceImageUrl ||
      productReferenceImageUrl !== savedProductReferenceImageUrl
    );
  }, [
    creatorReferenceImageUrl,
    description,
    name,
    productReferenceImageUrl,
    savedCreatorReferenceImageUrl,
    savedDescription,
    savedName,
    savedProductReferenceImageUrl,
  ]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: toNullableTrimmed(description),
          creatorReferenceImageUrl: toNullableTrimmed(creatorReferenceImageUrl),
          productReferenceImageUrl: toNullableTrimmed(productReferenceImageUrl),
        }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, "Failed to save project settings"));
      }

      setSavedName(name);
      setSavedDescription(description);
      setSavedCreatorReferenceImageUrl(creatorReferenceImageUrl);
      setSavedProductReferenceImageUrl(productReferenceImageUrl);
      setNotice("Project settings saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to save project settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(kind: ReferenceKind) {
    const file = kind === "creator" ? creatorFile : productFile;
    if (!file) {
      setError(`Select a ${kind} image first`);
      return;
    }

    setUploadingKind(kind);
    setError(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);

      const response = await fetch(`/api/projects/${projectId}/reference-images`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            kind?: ReferenceKind;
            url?: string;
            project?: {
              creatorReferenceImageUrl?: string | null;
              productReferenceImageUrl?: string | null;
            };
            error?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, "Failed to upload image"));
      }

      const creatorUrl = payload?.project?.creatorReferenceImageUrl ?? payload?.url ?? null;
      const productUrl = payload?.project?.productReferenceImageUrl ?? payload?.url ?? null;

      if (kind === "creator" && creatorUrl) {
        setCreatorReferenceImageUrl(creatorUrl);
        setSavedCreatorReferenceImageUrl(creatorUrl);
        setCreatorFile(null);
      }
      if (kind === "product" && productUrl) {
        setProductReferenceImageUrl(productUrl);
        setSavedProductReferenceImageUrl(productUrl);
        setProductFile(null);
      }

      setNotice(`${kind === "creator" ? "Creator" : "Product"} reference image uploaded.`);
    } catch (err: any) {
      setError(err?.message || "Failed to upload image");
    } finally {
      setUploadingKind(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Project Settings</h2>
        <span className="text-[11px] text-slate-500">Reference images feed prompt + Kling video generation</span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {notice && <p className="text-xs text-emerald-400">{notice}</p>}

      <form onSubmit={handleSave} className="space-y-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">Project Name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            placeholder="Project name"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">Description</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 min-h-[64px]"
            placeholder="Optional project description"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <label className="block text-xs font-semibold text-slate-200">Creator Reference Image</label>
            <input
              value={creatorReferenceImageUrl}
              onChange={(event) => setCreatorReferenceImageUrl(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="https://..."
            />
            {(() => {
              const safeSrc = sanitizeImageUrl(creatorReferenceImageUrl);
              return safeSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={safeSrc}
                  alt="Creator reference"
                  className="h-28 w-full rounded-md object-cover border border-slate-700"
                />
              ) : null;
            })()}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setCreatorFile(event.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-xs file:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void handleUpload("creator")}
              disabled={!creatorFile || uploadingKind !== null}
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium text-slate-100"
            >
              {uploadingKind === "creator" ? "Uploading..." : "Upload Creator Image"}
            </button>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <label className="block text-xs font-semibold text-slate-200">Product Reference Image</label>
            <input
              value={productReferenceImageUrl}
              onChange={(event) => setProductReferenceImageUrl(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="https://..."
            />
            {productReferenceImageUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={productReferenceImageUrl}
                alt="Product reference"
                className="h-28 w-full rounded-md object-cover border border-slate-700"
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setProductFile(event.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-xs file:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void handleUpload("product")}
              disabled={!productFile || uploadingKind !== null}
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium text-slate-100"
            >
              {uploadingKind === "product" ? "Uploading..." : "Upload Product Image"}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          `B_ROLL_ONLY` scenes ignore creator references. Max upload size: 10MB.
        </p>

        <button
          type="submit"
          disabled={saving || !hasPendingChanges}
          className="inline-flex items-center px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-xs font-medium text-slate-950"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </section>
  );
}
