"use client";

import { FormEvent, useMemo, useState } from "react";

type ProjectSettingsPanelProps = {
  projectId: string;
  initialName: string;
  initialDescription: string | null;
};

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

export function ProjectSettingsPanel({
  projectId,
  initialName,
  initialDescription,
}: ProjectSettingsPanelProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [savedName, setSavedName] = useState(initialName);
  const [savedDescription, setSavedDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasPendingChanges = useMemo(() => {
    return name !== savedName || description !== savedDescription;
  }, [description, name, savedDescription, savedName]);

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
        }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, "Failed to save project settings"));
      }

      setSavedName(name);
      setSavedDescription(description);
      setNotice("Project settings saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to save project settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-panel p-5 space-y-4 shadow-panel backdrop-blur-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white tracking-tight">Project Settings</h2>
        <span className="eyebrow !mb-0 text-[0.72rem]">Identifiers Only</span>
      </div>

      {error && <p className="text-xs text-accent font-mono">{error}</p>}
      {notice && <p className="text-xs text-success font-mono">{notice}</p>}

      <form onSubmit={handleSave} className="space-y-3">
        <div className="space-y-2">
          <label className="block text-[11px] font-mono text-muted uppercase tracking-wider">Project Name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-pill border border-line bg-[rgba(255,255,255,0.03)] px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors"
            placeholder="Project name"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] font-mono text-muted uppercase tracking-wider">Description</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-card border border-line bg-[rgba(255,255,255,0.03)] px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors min-h-[80px]"
            placeholder="Optional project description"
          />
        </div>

        <button
          type="submit"
          disabled={saving || !hasPendingChanges}
          className="btn btn-primary !min-h-[36px] px-5 text-xs font-bold shadow-[0_0_15px_rgba(232,209,122,0.15)]"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </section>
  );
}
