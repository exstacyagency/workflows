"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

type ProductCollectionJob = {
  id: string;
  type: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  error?: unknown;
  payload?: Record<string, unknown> | null;
  resultSummary?: unknown;
  createdAt: string;
  updatedAt: string;
};

type JobResponse = {
  success?: boolean;
  error?: string;
  job?: ProductCollectionJob;
};

type ProductIntelFieldKey =
  | "main_benefit"
  | "mechanismProcess"
  | "key_features"
  | "usage"
  | "price"
  | "format"
  | "specific_claims"
  | "variations"
  | "shipping";

type Citation = {
  source_url?: unknown;
  title?: unknown;
  quote?: unknown;
  verification_date?: unknown;
  source_domain?: unknown;
  source_confidence?: unknown;
  needs_reverification?: unknown;
  confidence_reason?: unknown;
};

const FIELD_LABELS: Record<ProductIntelFieldKey, string> = {
  main_benefit: "Main Benefit",
  mechanismProcess: "Mechanism",
  key_features: "Key Features",
  usage: "Usage",
  price: "Price",
  format: "Format",
  specific_claims: "Specific Claims",
  variations: "Variations",
  shipping: "Shipping",
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function asCitationArray(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object") as Citation[];
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ProductCollectionOutputPage() {
  const params = useParams();
  const projectId = String(params?.projectId ?? "");
  const jobId = String(params?.jobId ?? "");

  const [job, setJob] = useState<ProductCollectionJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJob = useCallback(async () => {
    if (!projectId || !jobId) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as JobResponse;

      if (!response.ok || !data.success || !data.job) {
        throw new Error(data.error || "Failed to load product collection output");
      }

      if (data.job.type !== "PRODUCT_DATA_COLLECTION") {
        throw new Error("This output is not a product collection job.");
      }

      setJob(data.job);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load product collection output";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [jobId, projectId]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  const payload = useMemo(() => asObject(job?.payload), [job]);
  const result = useMemo(() => asObject(payload.result), [payload]);
  const intel = useMemo(() => asObject(result.intel), [result]);
  const citations = useMemo(() => asObject(intel.citations), [intel]);
  const validation = useMemo(() => asObject(intel.validated_fields), [intel]);

  const productUrl = asString(payload.productUrl);
  const runId = asString(payload.runId);
  const researchHubHref = `/projects/${projectId}/research-hub${runId ? `?runId=${runId}` : ""}`;
  const mainBenefit = asString(intel.main_benefit);
  const mechanism = asString(intel.mechanismProcess);
  const usage = asString(intel.usage);
  const price = asString(intel.price);
  const format = asString(intel.format);
  const shipping = asString(intel.shipping);
  const keyFeatures = asStringArray(intel.key_features);
  const specificClaims = asStringArray(intel.specific_claims);
  const variations = asStringArray(intel.variations);
  const resolvedViaWebSearch = asStringArray(intel.resolved_via_web_search);
  const reverificationFields = asStringArray(intel.reverification_required_fields);

  const overviewItems = [
    { label: "Main Benefit", value: mainBenefit },
    { label: "Mechanism", value: mechanism },
    { label: "Usage", value: usage },
    { label: "Price", value: price },
    { label: "Format", value: format },
    { label: "Shipping", value: shipping },
  ].filter((item) => item.value);

  const listSections = [
    { key: "key_features", label: FIELD_LABELS.key_features, values: keyFeatures },
    { key: "specific_claims", label: FIELD_LABELS.specific_claims, values: specificClaims },
    { key: "variations", label: FIELD_LABELS.variations, values: variations },
  ].filter((section) => section.values.length > 0);

  const citationSections = (Object.keys(FIELD_LABELS) as ProductIntelFieldKey[])
    .map((field) => ({
      field,
      label: FIELD_LABELS[field],
      entries: asCitationArray(citations[field]),
    }))
    .filter((section) => section.entries.length > 0);

  if (loading) {
    return <LoadingState title="Loading product output" variant="page" />;
  }

  if (error) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <PageHeader
          backHref={researchHubHref}
          backLabel="Back to Research Hub"
          title="Product Output"
        />
        <EmptyState title="Unable to load output" description={error} variant="error" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <PageHeader
          backHref={researchHubHref}
          backLabel="Back to Research Hub"
          title="Product Output"
        />
        <EmptyState title="Product collection job not found" />
      </div>
    );
  }

  const hasIntel = Object.keys(intel).length > 0;

  return (
    <main className="px-8 py-8 max-w-6xl mx-auto space-y-8">
      <PageHeader
        backHref={researchHubHref}
        backLabel="Back to Research Hub"
        title="Product Output"
        description={
          productUrl
            ? `Full extracted intel for ${productUrl}`
            : "Full extracted intel from this product collection run."
        }
        actions={
          <>
            <StatusChip variant={job.status === "COMPLETED" ? "success" : "warning"}>
              {job.status}
            </StatusChip>
            <Link
              href={`/projects/${projectId}/research/data/${job.id}/inputs${runId ? `?runId=${runId}` : ""}`}
              className="btn btn-secondary !min-h-[36px] px-4 text-label"
            >
              View Input
            </Link>
            <button
              onClick={() => downloadJson(`product-collection-${job.id}.json`, intel)}
              disabled={!hasIntel}
              className="btn btn-secondary !min-h-[36px] px-4 text-label disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download JSON
            </button>
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <SectionCard className="space-y-2">
          <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">Job ID</p>
          <p className="text-sm font-mono text-white">{job.id}</p>
        </SectionCard>
        <SectionCard className="space-y-2">
          <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">Created</p>
          <p className="text-sm text-white">{formatDateTime(job.createdAt)}</p>
        </SectionCard>
        <SectionCard className="space-y-2">
          <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">Run ID</p>
          <p className="text-sm font-mono text-white">{runId || "—"}</p>
        </SectionCard>
      </div>

      {job.status === "FAILED" && (
        <EmptyState
          title="Product collection failed"
          description={asString(job.error) || "This job did not complete successfully."}
          variant="error"
        />
      )}

      {job.status === "COMPLETED" && !hasIntel && (
        <EmptyState
          title="No product intel found"
          description="This completed job does not include structured product intel output."
        />
      )}

      {hasIntel && (
        <>
          {overviewItems.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              {overviewItems.map((item) => (
                <SectionCard key={item.label} className="space-y-2">
                  <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                    {item.label}
                  </p>
                  <p className="text-sm leading-6 text-white whitespace-pre-wrap">{item.value}</p>
                </SectionCard>
              ))}
            </div>
          )}

          {listSections.length > 0 && (
            <div className="grid gap-6 md:grid-cols-3">
              {listSections.map((section) => (
                <SectionCard key={section.key} className="space-y-3">
                  <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                    {section.label}
                  </p>
                  <div className="space-y-2">
                    {section.values.map((value, index) => (
                      <div
                        key={`${section.key}-${index}`}
                        className="rounded-inner border border-line bg-bg-elevated px-3 py-2 text-sm text-white"
                      >
                        {value}
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}

          {(resolvedViaWebSearch.length > 0 || reverificationFields.length > 0) && (
            <div className="grid gap-6 md:grid-cols-2">
              {resolvedViaWebSearch.length > 0 && (
                <SectionCard className="space-y-3">
                  <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                    Resolved Via Web Search
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {resolvedViaWebSearch.map((field) => (
                      <StatusChip key={field} variant="subtle">
                        {FIELD_LABELS[field as ProductIntelFieldKey] ?? field}
                      </StatusChip>
                    ))}
                  </div>
                </SectionCard>
              )}

              {reverificationFields.length > 0 && (
                <SectionCard className="space-y-3">
                  <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                    Reverification Needed
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {reverificationFields.map((field) => (
                      <StatusChip key={field} variant="warning">
                        {FIELD_LABELS[field as ProductIntelFieldKey] ?? field}
                      </StatusChip>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          )}

          {Object.keys(validation).length > 0 && (
            <SectionCard className="space-y-4">
              <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                Field Validation
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(validation).map(([field, rawStatus]) => {
                  const item = asObject(rawStatus);
                  const status = asString(item.status);
                  const note = asString(item.note);
                  return (
                    <div
                      key={field}
                      className="rounded-card border border-line bg-bg-elevated p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">
                          {FIELD_LABELS[field as ProductIntelFieldKey] ?? field}
                        </p>
                        <StatusChip variant={status === "verified" ? "success" : "warning"}>
                          {status || "unknown"}
                        </StatusChip>
                      </div>
                      {note && <p className="text-sm text-muted leading-6">{note}</p>}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {citationSections.length > 0 && (
            <SectionCard className="space-y-5">
              <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                Supporting Citations
              </p>
              <div className="space-y-5">
                {citationSections.map((section) => (
                  <div key={section.field} className="space-y-3">
                    <p className="text-sm font-medium text-white">{section.label}</p>
                    <div className="grid gap-4">
                      {section.entries.map((entry, index) => {
                        const sourceUrl = asString(entry.source_url);
                        const title = asString(entry.title);
                        const quote = asString(entry.quote);
                        const verificationDate = asString(entry.verification_date);
                        const sourceDomain = asString(entry.source_domain);
                        const sourceConfidence = asString(entry.source_confidence);
                        const confidenceReason = asString(entry.confidence_reason);
                        const needsReverification = Boolean(entry.needs_reverification);

                        return (
                          <div
                            key={`${section.field}-${index}`}
                            className="rounded-card border border-line bg-bg-elevated p-4 space-y-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {sourceUrl ? (
                                <a
                                  href={sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-accent-2 underline underline-offset-4 break-all"
                                >
                                  {title || sourceUrl}
                                </a>
                              ) : (
                                <p className="text-sm text-white">{title || "Source"}</p>
                              )}
                              {sourceDomain && <StatusChip variant="subtle">{sourceDomain}</StatusChip>}
                              {sourceConfidence && (
                                <StatusChip
                                  variant={sourceConfidence === "high" ? "success" : "warning"}
                                >
                                  {sourceConfidence}
                                </StatusChip>
                              )}
                              {needsReverification && <StatusChip variant="warning">reverify</StatusChip>}
                            </div>
                            {quote && (
                              <p className="text-sm leading-6 text-muted whitespace-pre-wrap">
                                {quote}
                              </p>
                            )}
                            {(verificationDate || confidenceReason) && (
                              <p className="text-xs text-muted">
                                {[verificationDate, confidenceReason].filter(Boolean).join(" • ")}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-label-sm uppercase tracking-widest text-muted opacity-60">
                Raw Output
              </p>
              <button
                onClick={() => downloadJson(`product-collection-${job.id}-raw.json`, intel)}
                className="text-xs text-accent-2 underline underline-offset-4"
              >
                Download raw
              </button>
            </div>
            <pre className="overflow-x-auto rounded-card border border-line bg-bg-elevated p-5 text-xs leading-6 text-muted">
              {JSON.stringify(intel, null, 2)}
            </pre>
          </SectionCard>
        </>
      )}
    </main>
  );
}
