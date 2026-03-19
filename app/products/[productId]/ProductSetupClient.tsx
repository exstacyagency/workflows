"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";

export type ProductSetupData = {
  id: string;
  name: string;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterReferenceVideoUrl: string | null;
  characterAvatarImageUrl: string | null;
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
    creatorVisualPrompt: string | null;
    elevenLabsVoiceId: string | null;
    createdAt: string;
  }[];
  runs: { id: string; name: string | null }[];
  selectedRunId: string | null;
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
    characterAvatarImageUrl: string | null;
    characterCameoCreatedAt: string | null;
  };
};

type CharacterPreset = {
  id: string;
  label: string;
  description: string;
  anchor: string;
};

const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: "ambitious-professional",
    label: "Ambitious Professional",
    description: "Late 20s career-focused creator, polished but approachable",
    anchor:
      "Age: 27-32\nEthnicity: White\nHair: Dark brown, shoulder-length, straight, worn down\nEyes: Brown, almond-shaped\nSkin tone: Light with warm undertone\nFace: Strong jawline, high cheekbones, natural light makeup\nBuild: Slim, average height, upright posture\nWardrobe: Muted slate blue crewneck or white blouse, no logos, clean fit\nVocal tone: Confident, measured cadence, warm but authoritative — like a trusted colleague",
  },
  {
    id: "wellness-creator",
    label: "Wellness Creator",
    description: "Early 30s health-conscious creator, natural and grounded",
    anchor:
      "Age: 29-34\nEthnicity: Mixed (Black/White)\nHair: Natural curls, medium length, worn loose\nEyes: Dark brown, expressive\nSkin tone: Medium brown, even tone\nFace: Full lips, wide smile, minimal makeup, clear skin\nBuild: Athletic, medium height, relaxed posture\nWardrobe: Sage green or cream fitted tee, no logos, soft fabric\nVocal tone: Warm, unhurried, conversational — like a friend sharing advice",
  },
  {
    id: "relatable-millennial",
    label: "Relatable Millennial",
    description: "Mid 20s everyday creator, candid and unfiltered",
    anchor:
      "Age: 24-28\nEthnicity: Hispanic/Latina\nHair: Dark brown, wavy, mid-length, slightly tousled\nEyes: Dark brown, deep-set\nSkin tone: Warm olive, light natural finish\nFace: Full brows, soft features, occasional smile lines, no heavy makeup\nBuild: Average, medium height, casual relaxed stance\nWardrobe: Oversized heather grey tee or neutral hoodie, no logos\nVocal tone: Upbeat, slightly self-deprecating, fast-paced — like texting out loud",
  },
  {
    id: "fitness-enthusiast",
    label: "Fitness Enthusiast",
    description: "Late 20s active creator, energetic and direct",
    anchor:
      "Age: 26-31\nEthnicity: Asian (East Asian)\nHair: Black, short, clean cut\nEyes: Dark brown, narrow, focused\nSkin tone: Light with cool undertone, healthy flush\nFace: Sharp cheekbones, defined jaw, minimal expression lines\nBuild: Lean muscular, medium height, forward energy in posture\nWardrobe: Fitted black moisture-wick shirt, no logos\nVocal tone: Punchy, clipped sentences, high energy — motivational but not performative",
  },
  {
    id: "tech-savvy-user",
    label: "Tech-Savvy User",
    description: "Early 30s analytical creator, dry and precise",
    anchor:
      "Age: 30-35\nEthnicity: South Asian\nHair: Dark black, short, neatly combed\nEyes: Dark brown, sharp\nSkin tone: Medium brown, warm undertone\nFace: Strong nose, clean shave, focused neutral expression\nBuild: Slim, tall, still posture\nWardrobe: Navy or charcoal quarter-zip or button collar shirt, no logos\nVocal tone: Dry, analytical, slightly deadpan — like a product review you actually trust",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Define your own character with required fields",
    anchor: "",
  },
];

const CUSTOM_FIELDS = [
  { key: "Age:", placeholder: "e.g. 25-30" },
  { key: "Ethnicity:", placeholder: "e.g. Black, White, Hispanic, Asian, Mixed..." },
  { key: "Hair:", placeholder: "e.g. Dark brown, shoulder-length, straight, worn down" },
  { key: "Eyes:", placeholder: "e.g. Brown, almond-shaped" },
  { key: "Skin tone:", placeholder: "e.g. Medium brown, warm undertone" },
  { key: "Face:", placeholder: "e.g. High cheekbones, full brows, natural makeup" },
  { key: "Build:", placeholder: "e.g. Slim, average height, relaxed posture" },
  { key: "Wardrobe:", placeholder: "e.g. Sage green fitted tee, no logos" },
  { key: "Vocal tone:", placeholder: "e.g. Warm, conversational, like a trusted friend" },
];

const CHARACTER_PROFILE_KEYS = [
  "Age:",
  "Ethnicity:",
  "Hair:",
  "Eyes:",
  "Skin tone:",
  "Face:",
  "Build:",
  "Wardrobe:",
  "Vocal tone:",
] as const;

function getCharacterProfileField(prompt: string | null | undefined, key: string): string {
  const source = String(prompt ?? "");
  if (!source) return "Not provided";
  const line = source
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(key));
  if (!line) return "Not provided";
  const value = line.slice(key.length).trim();
  return value || "Not provided";
}

function buildCustomAnchor(fields: Record<string, string>): string {
  return CUSTOM_FIELDS.map(({ key }) => `${key} ${(fields[key] ?? "").trim()}`)
    .filter((line) => line.split(": ")[1]?.trim())
    .join("\n");
}

function validateAnchor(anchor: string): string[] {
  return CUSTOM_FIELDS.map(({ key }) => key).filter(
    (key) => !anchor.includes(key) || anchor.split(key)[1]?.trim().split("\n")[0]?.trim() === "",
  );
}

function extractError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

function prettyStatus(status: StageStatus["status"]): string {
  switch (status) {
    case "PENDING": return "Pending";
    case "RUNNING": return "Running";
    case "COMPLETED": return "Completed";
    case "FAILED": return "Failed";
    default: return status;
  }
}

function stageStatusText(stage: StageStatus): string {
  if (!stage.jobId) return "Not started";
  return prettyStatus(stage.status);
}

export function ProductSetupClient({ product }: { product: ProductSetupData }) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isDeletingCharacters, setIsDeletingCharacters] = useState(false);
  const [renamingCharacterId, setRenamingCharacterId] = useState<string | null>(null);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterName, setEditingCharacterName] = useState<string>("");
  const [cancellingCharacterJobId, setCancellingCharacterJobId] = useState<string | null>(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(product.selectedRunId ?? null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("ambitious-professional");
  const [newCharacterName, setNewCharacterName] = useState<string>("");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<CharacterPipelineStatusResponse | null>(null);
  const [anchorPreviewOpen, setAnchorPreviewOpen] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string } | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const selectedRunCharacter = product.characters[0] ?? null;

  const selectedPreset = CHARACTER_PRESETS.find((p) => p.id === selectedPresetId) ?? CHARACTER_PRESETS[0];
  const isCustom = selectedPresetId === "custom";
  const resolvedAnchor = isCustom ? buildCustomAnchor(customFields) : selectedPreset.anchor;
  const missingFields = isCustom ? validateAnchor(resolvedAnchor) : [];

  const refreshStatus = useCallback(async () => {
    const runParam = selectedRunId ? `&runId=${encodeURIComponent(selectedRunId)}` : "";
    const res = await fetch(
      `/api/jobs/character-generation/status?productId=${encodeURIComponent(product.id)}${runParam}`,
      { cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(extractError(data, "Failed to fetch character pipeline status"));
    setPipelineStatus(data as CharacterPipelineStatusResponse);
    return data as CharacterPipelineStatusResponse;
  }, [product.id, selectedRunId]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try { await refreshStatus(); }
      catch (err) { if (mounted) setError(err instanceof Error ? err.message : "Failed to load status"); }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 4000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [refreshStatus]);

  useEffect(() => {
    if (pipelineStatus?.isComplete && !selectedRunCharacter?.soraCharacterId) {
      window.setTimeout(() => window.location.reload(), 1200);
    }
  }, [pipelineStatus?.isComplete, selectedRunCharacter?.soraCharacterId]);

  const stages = useMemo(() => pipelineStatus?.stages ?? [], [pipelineStatus?.stages]);
  const hasInFlightStage = useMemo(
    () => stages.some((s) => Boolean(s.jobId) && (s.status === "PENDING" || s.status === "RUNNING")),
    [stages],
  );
  const canGenerate =
    !isGenerating &&
    !hasInFlightStage &&
    resolvedAnchor.trim().length > 0 &&
    missingFields.length === 0 &&
    newCharacterName.trim().length <= 120;
  const hasFailedStage = useMemo(() => stages.some((s) => s.status === "FAILED"), [stages]);

  const effectiveCharacterId =
    pipelineStatus?.character?.soraCharacterId ?? selectedRunCharacter?.soraCharacterId ?? null;
  const resolvedAvatarImageUrl =
    selectedRunCharacter?.seedVideoUrl ??
    product.characterSeedVideoUrl ??
    pipelineStatus?.character?.characterReferenceVideoUrl ??
    pipelineStatus?.character?.characterAvatarImageUrl ??
    product.characterReferenceVideoUrl ??
    product.characterAvatarImageUrl ??
    null;
  const allCharactersSelected =
    product.characters.length > 0 && selectedCharacterIds.length === product.characters.length;

  useEffect(() => { setSelectedCharacterIds([]); }, [selectedRunId, product.characters.length]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!avatarPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAvatarPreview(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [avatarPreview]);

  const handleRunChange = useCallback(
    (value: string | null) => {
      const nextRunId = value || null;
      setSelectedRunId(nextRunId);
      router.push(nextRunId ? `?runId=${encodeURIComponent(nextRunId)}` : "?");
    },
    [router],
  );

  async function handleGenerateCharacter() {
    setIsGenerating(true);
    setError(null);
    try {
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
      }
      const res = await fetch("/api/jobs/character-generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          manualDescription: resolvedAnchor,
          characterName: newCharacterName.trim() || null,
          runId: selectedRunId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractError(data, "Failed to start character generation"));
      await refreshStatus();
      setNewCharacterName("");
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
      const res = await fetch(`/api/products/${product.id}/reset-character`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractError(data, "Failed to reset character"));
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsResetting(false);
    }
  }

  async function handleDeleteSelectedCharacters() {
    if (selectedCharacterIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedCharacterIds.length} selected character${selectedCharacterIds.length === 1 ? "" : "s"}?`)) return;
    setIsDeletingCharacters(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}/characters`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterIds: selectedCharacterIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractError(data, "Failed to delete characters"));
      setSelectedCharacterIds([]);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsDeletingCharacters(false);
    }
  }

  async function handleCancelCharacterJob(jobId: string) {
    setCancellingCharacterJobId(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractError(data, "Failed to cancel character generation job"));
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCancellingCharacterJobId(null);
    }
  }

  function beginCharacterRename(characterId: string, currentName: string) {
    setEditingCharacterId(characterId);
    setEditingCharacterName(currentName);
    setError(null);
  }

  function cancelCharacterRename() {
    setEditingCharacterId(null);
    setEditingCharacterName("");
  }

  async function handleRenameCharacter(characterId: string) {
    const nextName = editingCharacterName.trim();
    if (!nextName) {
      setError("Character name is required.");
      return;
    }
    setRenamingCharacterId(characterId);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}/characters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId,
          name: nextName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractError(data, "Failed to rename character"));
      cancelCharacterRename();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRenamingCharacterId(null);
    }
  }

  function CharacterSelector() {
    return (
      <div className="space-y-4">
        {/* Preset grid */}
        <div>
          <div className="space-y-1 mb-3">
            <label className="text-xs text-muted">Character Name (optional)</label>
            <input
              type="text"
              value={newCharacterName}
              onChange={(e) => setNewCharacterName(e.target.value)}
              placeholder="e.g. Maya"
              maxLength={120}
              className="w-full rounded-inner border border-line bg-panel px-3 py-2 text-sm text-white placeholder:text-muted focus:border-accent-2 focus:outline-none"
            />
          </div>
          <p className="text-xs text-muted mb-2">Character archetype</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CHARACTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPresetId(preset.id)}
                className={`rounded-inner border p-3 text-left transition-colors ${
                  selectedPresetId === preset.id
                    ? "border-accent-2 bg-accent/10 text-accent-2"
                    : "border-line bg-panel text-muted hover:border-muted/40"
                }`}
              >
                <p className="text-xs font-medium leading-tight">{preset.label}</p>
                <p className="text-label text-muted mt-0.5 leading-tight">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Custom fields */}
        {isCustom && (
          <SectionCard className="space-y-2" padding="sm">
            <p className="text-xs text-muted mb-3">All fields required</p>
            {CUSTOM_FIELDS.map(({ key, placeholder }) => (
              <div key={key} className="flex items-start gap-3">
                <label className="w-24 shrink-0 pt-2 text-body-sm text-muted">{key}</label>
                <input
                  type="text"
                  value={customFields[key] ?? ""}
                  onChange={(e) => setCustomFields((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="flex-1 rounded-inner border border-line bg-panel px-3 py-2 text-xs text-white placeholder:text-muted focus:border-accent-2 focus:outline-none"
                />
              </div>
            ))}
          </SectionCard>
        )}

        {/* Anchor preview */}
        {resolvedAnchor && (
          <SectionCard padding="none">
            <button
              type="button"
              onClick={() => setAnchorPreviewOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted hover:text-muted"
            >
              <span>Anchor preview</span>
              <span>{anchorPreviewOpen ? "▲" : "▼"}</span>
            </button>
            {anchorPreviewOpen && (
              <pre className="px-4 pb-4 text-label text-muted whitespace-pre-wrap leading-relaxed">
                {resolvedAnchor}
              </pre>
            )}
          </SectionCard>
        )}

        {missingFields.length > 0 && (
          <p className="text-xs text-accent">
            Missing: {missingFields.join(", ")}
          </p>
        )}
      </div>
    );
  }

  function StageList() {
    if (stages.length === 0) {
      return <EmptyState title="No pipeline jobs yet" />;
    }
    return (
      <div className="space-y-2">
        {stages.map((stage) => (
          <SectionCard key={stage.type} padding="sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-white">{stage.label}</p>
              <div className="flex items-center gap-2">
                <p className={`text-xs ${
                  stage.status === "COMPLETED" ? "text-success"
                  : stage.status === "FAILED" ? "text-accent"
                  : stage.status === "RUNNING" ? "text-accent-2"
                  : "text-muted"
                }`}>
                  {stageStatusText(stage)}
                </p>
                {(stage.status === "RUNNING" || stage.status === "PENDING") &&
                  stage.jobId && (
                  <button
                    type="button"
                    onClick={() => void handleCancelCharacterJob(stage.jobId!)}
                    disabled={cancellingCharacterJobId === stage.jobId}
                    className="btn btn-danger !min-h-[28px] px-3 text-label disabled:opacity-60"
                  >
                    {cancellingCharacterJobId === stage.jobId ? "Cancelling..." : "Cancel"}
                  </button>
                  )}
              </div>
            </div>
            {stage.error && <p className="mt-2 text-xs text-accent">{stage.error}</p>}
          </SectionCard>
        ))}
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <SectionCard padding="md">
        <PageHeader
          eyebrow="Product Setup"
          title={product.name}
          description="Create your own custom character."
          actions={
            <Link
              href={`/projects/${product.project.id}/products`}
              className="btn btn-secondary !min-h-[32px] px-4 text-label"
            >
              Back to Products
            </Link>
          }
        />
      </SectionCard>

      {error && (
        <SectionCard padding="sm" className="border-accent/30 bg-accent/10">
          <p className="text-sm text-accent">{error}</p>
        </SectionCard>
      )}

      <SectionCard padding="md" className="space-y-4">
        <p className="eyebrow !mb-0">Character Generation</p>

        {!effectiveCharacterId ? (
          <>
            <SectionCard className="space-y-4" padding="sm">
              {/* Run selector */}
              <div className="space-y-1">
                <label className="text-xs text-muted">Attach to Run</label>
                <select
                  value={selectedRunId ?? ""}
                  onChange={(e) => handleRunChange(e.target.value || null)}
                  className="w-full rounded-inner border border-line bg-panel px-3 py-2 text-sm text-white focus:border-accent-2 focus:outline-none"
                >
                  <option value="">No active run (create new)</option>
                  {product.runs.map((r) => (
                    <option key={r.id} value={r.id}>{r.name ?? r.id}</option>
                  ))}
                </select>
              </div>

              <CharacterSelector />

              <button
                type="button"
                onClick={() => void handleGenerateCharacter()}
                disabled={!canGenerate}
                className="btn btn-primary !min-h-[32px] px-4 text-label disabled:opacity-60"
              >
                {isGenerating ? "Starting..." : "Generate Character"}
              </button>

            </SectionCard>

            <StageList />
            {hasFailedStage && (
              <p className="text-xs text-accent">
                A stage failed. Reset and rerun, or retry after fixing configuration.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-4">
            {resolvedAvatarImageUrl && (
              <SectionCard padding="sm">
                <p className="mb-2 text-xs text-muted">Current avatar</p>
                <button
                  type="button"
                  onClick={() =>
                    setAvatarPreview({
                      url: resolvedAvatarImageUrl,
                      name: product.characters[0]?.name ?? product.name,
                    })
                  }
                  className="inline-flex rounded border border-line focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <img
                    src={resolvedAvatarImageUrl}
                    alt="Current character avatar"
                    style={{ height: "120px", width: "80px", objectFit: "cover", objectPosition: "top", display: "block" }}
                    className="rounded cursor-zoom-in"
                  />
                </button>
              </SectionCard>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-success">
                {product.characters.length} Character{product.characters.length !== 1 ? "s" : ""} Ready
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddingCharacter((v) => !v)}
                  className="btn btn-primary !min-h-[32px] px-4 text-label"
                >
                  + Add Character
                </button>
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={isResetting}
                  className="btn btn-danger !min-h-[32px] px-4 text-label disabled:opacity-60"
                >
                  {isResetting ? "Resetting..." : "Reset All"}
                </button>
              </div>
            </div>

            {/* Run selector */}
            <div className="space-y-1">
              <label className="text-xs text-muted">Attach to Run</label>
              <select
                value={selectedRunId ?? ""}
                onChange={(e) => handleRunChange(e.target.value || null)}
                className="w-full rounded-inner border border-line bg-panel px-3 py-2 text-sm text-white focus:border-accent-2 focus:outline-none"
              >
                <option value="">No active run (create new)</option>
                {product.runs.map((r) => (
                  <option key={r.id} value={r.id}>{r.name ?? r.id}</option>
                ))}
              </select>
            </div>

            {/* Character list */}
            <div className="space-y-3">
              <SectionCard padding="sm" className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={allCharactersSelected}
                    onChange={(e) => {
                      setSelectedCharacterIds(e.target.checked ? product.characters.map((c) => c.id) : []);
                    }}
                  />
                  Select all
                </label>
                <button
                  type="button"
                  onClick={() => void handleDeleteSelectedCharacters()}
                  disabled={selectedCharacterIds.length === 0 || isDeletingCharacters}
                  className="btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-60"
                >
                  {isDeletingCharacters ? "Deleting..." : `Delete Selected (${selectedCharacterIds.length})`}
                </button>
              </SectionCard>

              {product.characters.map((char) => (
                <SectionCard key={char.id} padding="sm" className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCharacterIds.includes(char.id)}
                        onChange={(e) => {
                          setSelectedCharacterIds((prev) =>
                            e.target.checked
                              ? prev.includes(char.id) ? prev : [...prev, char.id]
                              : prev.filter((id) => id !== char.id),
                          );
                        }}
                      />
                    </label>
                    {editingCharacterId === char.id ? (
                      <input
                        type="text"
                        value={editingCharacterName}
                        onChange={(e) => setEditingCharacterName(e.target.value)}
                        className="flex-1 rounded-inner border border-line bg-panel px-2 py-1 text-sm text-white focus:border-accent-2 focus:outline-none"
                        maxLength={120}
                      />
                    ) : (
                      <p className="text-sm font-medium text-white flex-1">{char.name}</p>
                    )}
                    <p className="text-xs text-muted">{new Date(char.createdAt).toLocaleString()}</p>
                    {editingCharacterId === char.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRenameCharacter(char.id)}
                          disabled={renamingCharacterId === char.id}
                          className="btn btn-primary !min-h-[32px] px-4 text-label disabled:opacity-60"
                        >
                          {renamingCharacterId === char.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelCharacterRename}
                          disabled={renamingCharacterId === char.id}
                          className="btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => beginCharacterRename(char.id, char.name)}
                        className="btn btn-secondary !min-h-[32px] px-4 text-label"
                      >
                        Rename
                      </button>
                    )}
                  </div>
                  {char.seedVideoUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarPreview({ url: char.seedVideoUrl!, name: char.name })}
                      className="inline-flex rounded border border-line focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      <img
                        src={char.seedVideoUrl}
                        alt={`${char.name} avatar`}
                        onClick={() => setAvatarPreview({ url: char.seedVideoUrl!, name: char.name })}
                        style={{ height: "96px", width: "64px", objectFit: "cover", objectPosition: "top", display: "block" }}
                        className="rounded cursor-zoom-in"
                      />
                    </button>
                  )}
                  <div className="space-y-1 pt-1">
                    {CHARACTER_PROFILE_KEYS.map((key) => (
                      <p key={key} className="text-xs text-muted">
                        <span className="text-muted">{key}</span>{" "}
                        {getCharacterProfileField(char.creatorVisualPrompt, key)}
                      </p>
                    ))}
                  </div>
                </SectionCard>
              ))}
            </div>

            {/* Add character panel */}
            {addingCharacter && (
              <SectionCard className="space-y-4" padding="sm">
                <p className="text-xs text-muted">Generate an additional character for this product.</p>
                <CharacterSelector />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGenerateCharacter()}
                    disabled={!canGenerate}
                    className="btn btn-primary !min-h-[32px] px-4 text-label disabled:opacity-60"
                  >
                    {isGenerating ? "Starting..." : "Generate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingCharacter(false)}
                    className="btn btn-secondary !min-h-[32px] px-4 text-label"
                  >
                    Cancel
                  </button>
                </div>
                {hasInFlightStage && (
                  <p className="text-xs text-accent">Pipeline already running — wait for it to finish.</p>
                )}
              </SectionCard>
            )}

            {hasInFlightStage && <StageList />}
          </div>
        )}
      </SectionCard>

      {isMounted &&
        avatarPreview &&
        createPortal(
          <div
            className="app-modal-shell"
            style={{ zIndex: 2147483647 }}
            onClick={() => setAvatarPreview(null)}
          >
            <div
              className="app-modal-card rounded-card border border-line bg-bg p-4 shadow-panel"
              style={{ maxWidth: 420 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-medium text-white">{avatarPreview.name}</p>
                <button
                  type="button"
                  onClick={() => setAvatarPreview(null)}
                  className="btn btn-secondary !min-h-[32px] px-4 text-body-sm font-semibold"
                >
                  Close
                </button>
              </div>
              <img
                src={avatarPreview.url}
                alt={`${avatarPreview.name} avatar preview`}
                className="mx-auto block max-h-[70vh] max-w-full rounded-card border border-line"
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
