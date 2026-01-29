'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Project = {
  id: string;
  name: string;
  description?: string | null;
};

type CustomerAvatar = {
  id: string;
  age?: number | null;
  gender?: string | null;
  income?: number | null;
  jobTitle?: string | null;
  location?: string | null;
  ethnicity?: string | null;
  primaryPain?: string | null;
  primaryGoal?: string | null;
  hasRaw?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
};

type ProductIntel = {
  id: string;
  heroIngredient?: string | null;
  heroMechanism?: string | null;
  form?: string | null;
  initialTimeline?: string | null;
  peakTimeline?: string | null;
  hasRaw?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
};

export default function CustomerProfilePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [productName, setProductName] = useState('');
  const [productProblem, setProductProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatar, setAvatar] = useState<CustomerAvatar | null>(null);
  const [productIntel, setProductIntel] = useState<ProductIntel | null>(null);
  const [avatarHistory, setAvatarHistory] = useState<CustomerAvatar[]>([]);
  const [productHistory, setProductHistory] = useState<ProductIntel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<'avatar' | 'intel' | null>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);

  // Load projects on mount
  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) {
          throw new Error('Failed to load projects');
        }
        const data = await res.json();
        setProjects(data ?? []);
      } catch (err: any) {
        console.error(err);
        setError('Unable to load projects.');
      }
    }

    loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setAvatar(null);
      setProductIntel(null);
      setAvatarHistory([]);
      setProductHistory([]);
      return;
    }
    loadSnapshots(selectedProjectId);
  }, [selectedProjectId]);

  const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  async function loadSnapshots(projectId: string) {
    try {
      const [avatarsRes, intelRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/customer-avatar?view=all`),
        fetch(`/api/projects/${projectId}/product-intelligence?view=all`),
      ]);

      if (avatarsRes.ok) {
        const avatars: CustomerAvatar[] = await avatarsRes.json();
        setAvatarHistory(avatars);
        const active = avatars.find(a => !a.archivedAt) ?? avatars[0] ?? null;
        setAvatar(active);
      } else {
        setAvatarHistory([]);
        setAvatar(null);
      }

      if (intelRes.ok) {
        const intelList: ProductIntel[] = await intelRes.json();
        setProductHistory(intelList);
        const activeIntel = intelList.find(i => !i.archivedAt) ?? intelList[0] ?? null;
        setProductIntel(activeIntel);
      } else {
        setProductHistory([]);
        setProductIntel(null);
      }
    } catch (err) {
      console.error(err);
      setError('Unable to load customer profile snapshots.');
    }
  }

  async function mutateSnapshot(
    type: 'avatar' | 'intel',
    id: string,
    action: 'archive' | 'restore' | 'delete',
  ) {
    if (!selectedProjectId) {
      setError('Select a project first.');
      return;
    }

    const base =
      type === 'avatar'
        ? `/api/projects/${selectedProjectId}/customer-avatar/${id}`
        : `/api/projects/${selectedProjectId}/product-intelligence/${id}`;

    const options: RequestInit =
      action === 'delete'
        ? { method: 'DELETE' }
        : {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action === 'restore' ? 'restore' : 'archive' }),
          };

    try {
      const res = await fetch(base, options);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Unable to update snapshot.');
      }
      await loadSnapshots(selectedProjectId);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Unable to update snapshot.');
    }
  }

  async function runCustomerAnalysis() {
    setError(null);
    setStatusMessage(null);
    setAvatar(null);
    setProductIntel(null);

    if (!selectedProjectId) {
      setError('Please select a project.');
      return;
    }

    setLoading(true);

    try {
      // 1) Start the job
      const payload: Record<string, string> = {
        projectId: selectedProjectId,
      };
      if (productName.trim()) {
        payload.productName = productName.trim();
      }
      if (productProblem.trim()) {
        payload.productProblemSolved = productProblem.trim();
      }

      const res = await fetch('/api/jobs/customer-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Customer analysis failed.');
      }

      const jobResult = await res.json();
      if (jobResult.summary) {
        const avatarSummary = jobResult.summary.avatar;
        const productSummary = jobResult.summary.product;
        const parts: string[] = [];
        if (avatarSummary?.primaryPain) {
          parts.push(`Avatar pain: ${avatarSummary.primaryPain}`);
        }
        if (productSummary?.heroIngredient) {
          parts.push(`Hero ingredient: ${productSummary.heroIngredient}`);
        }
        setStatusMessage(parts.length ? parts.join(' | ') : 'Analysis complete.');
      } else {
        setStatusMessage('Analysis complete.');
      }

      await loadSnapshots(selectedProjectId);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Customer analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadJson(type: 'avatar' | 'intel', snapshotId?: string) {
    if (!selectedProjectId) {
      setError('Please select a project before downloading.');
      return;
    }
    setError(null);
    setDownloading(type);
    try {
      const idParam = snapshotId ? `&id=${snapshotId}` : '';
      const endpoint =
        type === 'avatar'
          ? `/api/projects/${selectedProjectId}/customer-avatar?download=1${idParam}`
          : `/api/projects/${selectedProjectId}/product-intelligence?download=1${idParam}`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Download failed.');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        type === 'avatar'
          ? `${selectedProjectId}-customer-avatar-${snapshotId ?? 'latest'}.json`
          : `${selectedProjectId}-product-intelligence-${snapshotId ?? 'latest'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Download failed.');
    } finally {
      setDownloading(null);
    }
  }

  const activeAvatarCount = avatarHistory.filter(a => !a.archivedAt).length;
  const activeProductCount = productHistory.filter(i => !i.archivedAt).length;
  const hasAnalysis = Boolean(avatar && productIntel && selectedProjectId);
  const adResearchHref = selectedProjectId ? `/projects/${selectedProjectId}?stage=pattern-analysis` : '#';
  const scriptHref = selectedProjectId ? `/projects/${selectedProjectId}?stage=script-generation` : '#';
  const editResearchHref = selectedProjectId ? `/projects/${selectedProjectId}/research` : '#';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Step 3 – Customer profile</h1>
          <p className="text-slate-300 text-sm">
            Use your Phase 1A research (Reddit + Amazon) to generate a structured
            customer avatar and product intelligence for a selected project.
          </p>
        </header>

        {/* Controls */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">
                Project
              </label>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
              >
                <option value="">Select a project…</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">
                Product name <span className="text-slate-500 text-xs">(optional if provided in Phase 1A)</span>
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="e.g. ClearGlow Acne Serum"
              />
            </div>
          </div>

          <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">
                Problem it solves <span className="text-slate-500 text-xs">(optional)</span>
              </label>
            <textarea
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm min-h-[80px]"
              value={productProblem}
              onChange={e => setProductProblem(e.target.value)}
              placeholder="Describe the main problem this product solves in the customer's life."
            />
          </div>

          <button
            onClick={runCustomerAnalysis}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? 'Running analysis…' : 'Generate avatar + product intelligence'}
          </button>

          {error && (
            <p className="text-sm text-red-400">
              {error}
            </p>
          )}
          {statusMessage && (
            <p className="text-sm text-emerald-400">
              {statusMessage}
            </p>
          )}

          <p className="text-xs text-slate-500">
            Note: this requires Phase 1A research rows and valid Anthropic credentials. Leave the product fields blank to reuse the offering
            info captured during customer research.
          </p>
        </section>

        {hasAnalysis && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Next steps</h2>
              <p className="text-xs text-slate-400">
                Move into pattern analysis or jump straight to script work now that Phase 1B is complete.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={adResearchHref}
                className="inline-flex items-center justify-center rounded-md bg-sky-500 hover:bg-sky-400 px-4 py-2 text-sm font-medium text-white"
              >
                Continue to Ad Research
              </Link>
              <Link
                href={scriptHref}
                className="inline-flex items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800"
              >
                Generate Script
              </Link>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoreActions(v => !v)}
                  className="inline-flex items-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                >
                  More actions ▾
                </button>
                {showMoreActions && (
                  <div className="absolute right-0 mt-2 w-48 rounded-md border border-slate-800 bg-slate-950/95 shadow-lg">
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                      onClick={() => {
                        setShowMoreActions(false);
                        if (editResearchHref !== '#') {
                          router.push(editResearchHref);
                        }
                      }}
                    >
                      Edit customer research
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Results */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Avatar card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="text-lg font-semibold">Customer avatar</h2>
            {!avatar && (
              <p className="text-sm text-slate-400">
                Run analysis to see the avatar for this project.
              </p>
            )}
            {avatar && (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Age:</span>{' '}
                  {avatar.age ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Gender:</span>{' '}
                  {avatar.gender ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Job:</span>{' '}
                  {avatar.jobTitle ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Location:</span>{' '}
                  {avatar.location ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Primary pain:</span>{' '}
                  {avatar.primaryPain ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Primary goal:</span>{' '}
                  {avatar.primaryGoal ?? '—'}
                </p>
                <button
                  onClick={() => downloadJson('avatar', avatar.id)}
                  disabled={!avatar.hasRaw || downloading === 'avatar'}
                  className="mt-2 text-xs inline-flex items-center px-3 py-1.5 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  {downloading === 'avatar' ? 'Preparing download…' : 'Download JSON'}
                </button>
              </div>
            )}
          </div>

          {/* Product intelligence card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="text-lg font-semibold">Product intelligence</h2>
            {!productIntel && (
              <p className="text-sm text-slate-400">
                Run analysis to see product intelligence for this project.
              </p>
            )}
            {productIntel && (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Hero ingredient:</span>{' '}
                  {productIntel.heroIngredient ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Mechanism:</span>{' '}
                  {productIntel.heroMechanism ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Form:</span>{' '}
                  {productIntel.form ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Initial timeline:</span>{' '}
                  {productIntel.initialTimeline ?? '—'}
                </p>
                <p>
                  <span className="font-medium">Peak timeline:</span>{' '}
                  {productIntel.peakTimeline ?? '—'}
                </p>
                <button
                  onClick={() => downloadJson('intel', productIntel.id)}
                  disabled={!productIntel.hasRaw || downloading === 'intel'}
                  className="mt-2 text-xs inline-flex items-center px-3 py-1.5 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  {downloading === 'intel' ? 'Preparing download…' : 'Download JSON'}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="text-lg font-semibold">Snapshot history</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Customer avatars</h3>
                <span className="text-xs text-slate-500">{avatarHistory.length} total</span>
              </div>
              {avatarHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No avatars captured yet.</p>
              ) : (
                avatarHistory.map(item => (
                  <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{formatDate(item.createdAt)}</span>
                      <span className={item.archivedAt ? 'text-amber-400' : 'text-emerald-400'}>
                        {item.archivedAt ? 'Archived' : 'Active'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Pain: {item.primaryPain ?? '—'}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <button
                        onClick={() => downloadJson('avatar', item.id)}
                        className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800"
                      >
                        Download
                      </button>
                      {item.archivedAt ? (
                        <button
                          onClick={() => mutateSnapshot('avatar', item.id, 'restore')}
                          className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => mutateSnapshot('avatar', item.id, 'archive')}
                          disabled={activeAvatarCount <= 1}
                          className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => mutateSnapshot('avatar', item.id, 'delete')}
                        className="px-2 py-1 rounded-md border border-red-700 text-red-200 hover:bg-red-900"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Product intelligence</h3>
                <span className="text-xs text-slate-500">{productHistory.length} total</span>
              </div>
              {productHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No product intelligence captured yet.</p>
              ) : (
                productHistory.map(item => (
                  <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{formatDate(item.createdAt)}</span>
                      <span className={item.archivedAt ? 'text-amber-400' : 'text-emerald-400'}>
                        {item.archivedAt ? 'Archived' : 'Active'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Hero ingredient: {item.heroIngredient ?? '—'}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <button
                        onClick={() => downloadJson('intel', item.id)}
                        className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800"
                      >
                        Download
                      </button>
                      {item.archivedAt ? (
                        <button
                          onClick={() => mutateSnapshot('intel', item.id, 'restore')}
                          className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => mutateSnapshot('intel', item.id, 'archive')}
                          disabled={activeProductCount <= 1}
                          className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => mutateSnapshot('intel', item.id, 'delete')}
                        className="px-2 py-1 rounded-md border border-red-700 text-red-200 hover:bg-red-900"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Archived snapshots older than 90 days are automatically removed.
          </p>
        </section>
      </div>
    </main>
  );
}
