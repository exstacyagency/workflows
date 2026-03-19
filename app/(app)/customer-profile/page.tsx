'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SectionCard, StatusChip } from '@/components/ui';

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
        const res = await fetch('/api/projects', { credentials: 'include' });
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
        fetch(`/api/projects/${projectId}/customer-avatar?view=all`, { credentials: 'include' }),
        fetch(`/api/projects/${projectId}/product-intelligence?view=all`, { credentials: 'include' }),
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
        ? { method: 'DELETE', credentials: 'include' }
        : {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action === 'restore' ? 'restore' : 'archive' }),
            credentials: 'include',
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
      if (productProblem.trim()) {
        payload.productProblemSolved = productProblem.trim();
      }

      const res = await fetch('/api/jobs/customer-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
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
      const res = await fetch(endpoint, { credentials: 'include' });
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
    <main className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Step 3 - Customer Profile"
          description="Use your Phase 1A research (Reddit + Amazon) to generate a structured customer avatar and product intelligence for a selected project."
        />

        {/* Controls */}
        <SectionCard padding="sm" className="space-y-4">
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">
                Project
              </label>
              <select
                className="w-full rounded-inner bg-bg border border-line px-3 py-2 text-sm"
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
          </div>

          <div className="space-y-2">
              <label className="text-sm font-medium text-white">
                Problem it solves <span className="text-muted text-xs">(optional)</span>
              </label>
            <textarea
              className="w-full rounded-inner bg-bg border border-line px-3 py-2 text-sm min-h-[80px]"
              value={productProblem}
              onChange={e => setProductProblem(e.target.value)}
              placeholder="Describe the main problem this product solves in the customer's life."
            />
          </div>

          <button
            onClick={runCustomerAnalysis}
            disabled={loading}
            className="btn btn-primary !min-h-[36px] px-6 disabled:opacity-50"
          >
            {loading ? 'Running analysis…' : 'Generate avatar + product intelligence'}
          </button>

          {error && (
            <p className="text-sm text-accent">
              {error}
            </p>
          )}
          {statusMessage && (
            <p className="text-sm text-success">
              {statusMessage}
            </p>
          )}

          <p className="text-xs text-muted">
            Note: this requires Phase 1A research rows and valid Anthropic credentials. Leave the problem field blank to reuse the value captured
            during customer research.
          </p>
        </SectionCard>

        {hasAnalysis && (
          <SectionCard padding="sm" className="space-y-3">
            <div>
              <p className="eyebrow !mb-0">Next Steps</p>
              <p className="text-xs text-muted">
                Move into pattern analysis or jump straight to script work now that Phase 1B is complete.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={adResearchHref}
                className="btn btn-primary !min-h-[36px] px-6"
              >
                Continue to Ad Collection
              </Link>
              <Link
                href={scriptHref}
                className="btn btn-secondary !min-h-[36px] px-6"
              >
                Generate Script
              </Link>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoreActions(v => !v)}
                  className="btn btn-secondary !min-h-[36px] px-4"
                >
                  More actions ▾
                </button>
                {showMoreActions && (
                  <div className="absolute right-0 mt-2 w-48 rounded-inner border border-line bg-bg/95 shadow-lg">
                    <button
                      className="btn btn-secondary w-full !min-h-[36px] justify-start rounded-none border-0 px-3"
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
          </SectionCard>
        )}

        {/* Results */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Avatar card */}
          <SectionCard padding="sm" className="space-y-3">
            <p className="eyebrow">Customer Avatar</p>
            {!avatar && (
              <EmptyState title="No customer avatar yet" description="Run analysis to see the avatar for this project." />
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
                  className="mt-2 btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-40"
                >
                  {downloading === 'avatar' ? 'Preparing download…' : 'Download JSON'}
                </button>
              </div>
            )}
          </SectionCard>

          {/* Product intelligence card */}
          <SectionCard padding="sm" className="space-y-3">
            <p className="eyebrow">Product Intelligence</p>
            {!productIntel && (
              <EmptyState title="No product intelligence yet" description="Run analysis to see product intelligence for this project." />
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
                  className="mt-2 btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-40"
                >
                  {downloading === 'intel' ? 'Preparing download…' : 'Download JSON'}
                </button>
              </div>
            )}
          </SectionCard>
        </section>

        <SectionCard padding="sm" className="space-y-4">
          <p className="eyebrow">Snapshot History</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="eyebrow !mb-0">Customer Avatars</p>
                <span className="text-xs text-muted">{avatarHistory.length} total</span>
              </div>
              {avatarHistory.length === 0 ? (
                <EmptyState title="No avatars captured yet" />
              ) : (
                avatarHistory.map(item => (
                  <SectionCard key={item.id} padding="sm" className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{formatDate(item.createdAt)}</span>
                      <StatusChip variant={item.archivedAt ? 'warning' : 'success'} className="!px-2 !py-0.5 !text-label-xs">
                        {item.archivedAt ? 'Archived' : 'Active'}
                      </StatusChip>
                    </div>
                    <p className="text-xs text-muted">
                      Pain: {item.primaryPain ?? '—'}
                    </p>
                    <div className="flex flex-wrap gap-2 text-body-sm">
                      <button
                        onClick={() => downloadJson('avatar', item.id)}
                        className="btn btn-secondary !min-h-[28px] px-3 text-label"
                      >
                        Download
                      </button>
                      {item.archivedAt ? (
                        <button
                          onClick={() => mutateSnapshot('avatar', item.id, 'restore')}
                          className="btn btn-secondary !min-h-[28px] px-3 text-label"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => mutateSnapshot('avatar', item.id, 'archive')}
                          disabled={activeAvatarCount <= 1}
                          className="btn btn-secondary !min-h-[28px] px-3 text-label disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => mutateSnapshot('avatar', item.id, 'delete')}
                        className="btn btn-danger !min-h-[28px] px-3 text-label"
                      >
                        Delete
                      </button>
                    </div>
                  </SectionCard>
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="eyebrow !mb-0">Product Intelligence</p>
                <span className="text-xs text-muted">{productHistory.length} total</span>
              </div>
              {productHistory.length === 0 ? (
                <EmptyState title="No product intelligence captured yet" />
              ) : (
                productHistory.map(item => (
                  <SectionCard key={item.id} padding="sm" className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{formatDate(item.createdAt)}</span>
                      <StatusChip variant={item.archivedAt ? 'warning' : 'success'} className="!px-2 !py-0.5 !text-label-xs">
                        {item.archivedAt ? 'Archived' : 'Active'}
                      </StatusChip>
                    </div>
                    <p className="text-xs text-muted">
                      Hero ingredient: {item.heroIngredient ?? '—'}
                    </p>
                    <div className="flex flex-wrap gap-2 text-body-sm">
                      <button
                        onClick={() => downloadJson('intel', item.id)}
                        className="btn btn-secondary !min-h-[28px] px-3 text-label"
                      >
                        Download
                      </button>
                      {item.archivedAt ? (
                        <button
                          onClick={() => mutateSnapshot('intel', item.id, 'restore')}
                          className="btn btn-secondary !min-h-[28px] px-3 text-label"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => mutateSnapshot('intel', item.id, 'archive')}
                          disabled={activeProductCount <= 1}
                          className="btn btn-secondary !min-h-[28px] px-3 text-label disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => mutateSnapshot('intel', item.id, 'delete')}
                        className="btn btn-danger !min-h-[28px] px-3 text-label"
                      >
                        Delete
                      </button>
                    </div>
                  </SectionCard>
                ))
              )}
            </div>
          </div>
          <p className="text-body-sm text-muted">
            Archived snapshots older than 90 days are automatically removed.
          </p>
        </SectionCard>
    </main>
  );
}
