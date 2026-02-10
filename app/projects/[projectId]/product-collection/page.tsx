"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJobTypeLabel } from "@/lib/jobLabels";

type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
type JobType = "PRODUCT_DATA_COLLECTION";

type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  error?: string | null;
  resultSummary?: unknown;
  payload?: {
    productId?: string;
    productUrl?: string;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
  runId?: string | null;
};

type ProductOption = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
};

type JobsResponse = {
  success: boolean;
  jobs: Job[];
};

type ProductsResponse = {
  success: boolean;
  products: ProductOption[];
};

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    PENDING: "bg-slate-500/20 text-slate-300",
    RUNNING: "bg-sky-500/20 text-sky-400",
    COMPLETED: "bg-emerald-500/20 text-emerald-400",
    FAILED: "bg-red-500/20 text-red-400",
  };

  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function ProductCollectionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const selectedProductFromUrl = searchParams.get("productId") || searchParams.get("product");
  const urlParam = searchParams.get("url");

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previousJobs, setPreviousJobs] = useState<Job[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(selectedProductFromUrl);
  const [productUrl, setProductUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProductRef = useRef<string | null>(selectedProductId);

  useEffect(() => {
    selectedProductRef.current = selectedProductId;
  }, [selectedProductId]);

  useEffect(() => {
    if (!urlParam) return;
    try {
      setProductUrl(decodeURIComponent(urlParam));
    } catch {
      setProductUrl(urlParam);
    }
  }, [urlParam]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const runningJob = useMemo(
    () => jobs.find((job) => job.status === "RUNNING") ?? null,
    [jobs]
  );

  const pendingJob = useMemo(
    () => jobs.find((job) => job.status === "PENDING") ?? null,
    [jobs]
  );

  const latestJob = useMemo(() => {
    if (jobs.length === 0) return null;
    return [...jobs].sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
    )[0];
  }, [jobs]);

  const latestCompletedJob = useMemo(
    () => jobs.find((job) => job.status === "COMPLETED") ?? null,
    [jobs]
  );

  const inFlightJob = runningJob ?? pendingJob;
  const activeStatusJob = useMemo(() => {
    const result = inFlightJob ?? latestJob;
    console.log("[MEMO] activeStatusJob updated:", result?.status);
    return result;
  }, [inFlightJob, latestJob]);
  const isCollecting = Boolean(inFlightJob) || isSubmitting;

  const loadProducts = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/products`, { cache: "no-store" });
    const data = (await response.json()) as ProductsResponse;
    if (!response.ok || !data.success) {
      throw new Error("Failed to load products");
    }

    const nextProducts = Array.isArray(data.products) ? data.products : [];
    setProducts(nextProducts);

    if (nextProducts.length === 0) {
      setSelectedProductId(null);
      return;
    }

    const stillExists =
      selectedProductRef.current &&
      nextProducts.some((product) => product.id === selectedProductRef.current);

    const nextSelectedProductId = stillExists
      ? selectedProductRef.current
      : selectedProductFromUrl && nextProducts.some((product) => product.id === selectedProductFromUrl)
        ? selectedProductFromUrl
        : nextProducts[0].id;

    setSelectedProductId(nextSelectedProductId);
  }, [projectId, selectedProductFromUrl]);

  const loadJobs = useCallback(
    async (forceProductId?: string, options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) setLoading(true);

      try {
        const response = await fetch(
          `/api/projects/${projectId}/jobs?type=PRODUCT_DATA_COLLECTION`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as JobsResponse;

        if (!response.ok || !data.success) {
          throw new Error("Failed to load jobs");
        }

        const productId = forceProductId ?? selectedProductRef.current;
        if (!productId) {
          setJobs([]);
          return;
        }

        const normalizedProductId = String(productId || "").trim();
        const filtered = (data.jobs || []).filter((job) => {
          const jobProdId = String(job.payload?.productId || "").trim();
          if (!jobProdId || !normalizedProductId) return false;
          const match =
            jobProdId === normalizedProductId ||
            jobProdId.includes(normalizedProductId) ||
            normalizedProductId.includes(jobProdId);
          return match;
        });
        console.log("[loadJobs] Filtered:", filtered.length, "jobs for product:", normalizedProductId);
        console.log(
          "[loadJobs] Jobs detail:",
          filtered.map((j) => ({ status: j.status, id: j.id.slice(0, 8) }))
        );
        setJobs((prevJobs) => {
          setPreviousJobs(prevJobs);
          return filtered;
        });
        if (!silent) {
          console.log(
            "[UI UPDATE] Jobs state:",
            filtered.length,
            "Active job:",
            filtered.find((j) => j.status === "RUNNING" || j.status === "PENDING")
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        await loadProducts();
      } catch (error) {
        if (mounted) {
          setStatusMessage("Failed to load products.");
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, [loadProducts]);

  useEffect(() => {
    if (!selectedProductId) {
      setJobs([]);
      setLoading(false);
      return;
    }

    loadJobs(selectedProductId);
  }, [loadJobs, selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) return;

    const intervalMs = inFlightJob ? 1000 : 3000;
    const timer = setInterval(() => {
      loadJobs(selectedProductId, { silent: true });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [inFlightJob, loadJobs, selectedProductId]);

  useEffect(() => {
    if (previousJobs.length === 0) return;

    const completed = jobs.find(
      (job) =>
        job.status === "COMPLETED" &&
        previousJobs.some(
          (prev) =>
            prev.id === job.id && (prev.status === "RUNNING" || prev.status === "PENDING")
        )
    );
    if (completed) {
      setStatusMessage("Product Collection completed");
      return;
    }

    const failed = jobs.find(
      (job) =>
        job.status === "FAILED" &&
        previousJobs.some(
          (prev) =>
            prev.id === job.id && (prev.status === "RUNNING" || prev.status === "PENDING")
        )
    );
    if (failed) {
      setStatusMessage(failed.error || "Product Collection failed");
    }
  }, [jobs, previousJobs]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const cancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to cancel job");
      }

      setStatusMessage("Job cancelled");
      await loadJobs(selectedProductId || undefined, { silent: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error cancelling job";
      setStatusMessage(message);
    }
  };

  const runCollection = async () => {
    if (!selectedProductId) {
      setStatusMessage("Select a product before running collection.");
      return;
    }

    if (!productUrl.trim()) {
      setStatusMessage("Product URL is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/jobs/product-data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productId: selectedProductId,
          productName: selectedProduct?.name,
          productUrl: productUrl.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to start product collection");
      }

      setStatusMessage("Job started");
      await loadJobs(selectedProductId, { silent: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to start job";
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Link
            href={`/projects/${projectId}/research-hub${selectedProductId ? `?productId=${selectedProductId}` : ""}`}
            className="text-sm text-sky-400 hover:text-sky-300"
          >
            ← Back to Research Hub
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Product Collection</h1>
          <p className="mt-1 text-sm text-slate-400">
            Collect structured product intelligence from a main product URL.
          </p>
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-4">
          {statusMessage && <p className="text-xs text-slate-300">{statusMessage}</p>}

          {activeStatusJob && (
            <div className="rounded-lg border p-3 bg-slate-900/80 border-slate-700">
              <p
                className={`text-sm font-medium ${
                  activeStatusJob.status === "RUNNING"
                    ? "text-sky-300"
                    : activeStatusJob.status === "FAILED"
                      ? "text-red-300"
                      : activeStatusJob.status === "COMPLETED"
                        ? "text-emerald-300"
                        : "text-slate-300"
                }`}
              >
                {activeStatusJob.status}
              </p>
              <p className="text-xs text-slate-400">{getJobTypeLabel(activeStatusJob.type)}</p>
              {activeStatusJob.status === "FAILED" && activeStatusJob.error && (
                <p className="mt-2 text-xs text-red-400">{activeStatusJob.error}</p>
              )}
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs text-slate-400">Product</label>
            <select
              value={selectedProductId || ""}
              onChange={(event) => {
                const nextProductId = event.target.value || null;
                setSelectedProductId(nextProductId);
                const url = new URL(window.location.href);
                if (nextProductId) {
                  url.searchParams.set("productId", nextProductId);
                } else {
                  url.searchParams.delete("productId");
                }
                url.searchParams.delete("product");
                router.replace(url.pathname + url.search, { scroll: false });
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            >
              {products.length === 0 && <option value="">No products found</option>}
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs text-slate-400">Product URL</label>
            <input
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
              placeholder="https://example.com/products/..."
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runCollection}
              disabled={!selectedProductId || isCollecting}
              className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 ${
                !selectedProductId || isCollecting
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-violet-500 hover:bg-violet-400 text-white"
              }`}
            >
              {inFlightJob ? inFlightJob.status : isSubmitting ? "Starting..." : "Run"}
            </button>

            {inFlightJob && (
              <button
                onClick={() => cancelJob(inFlightJob.id)}
                className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
              >
                Cancel
              </button>
            )}

            {latestCompletedJob ? (
              <Link
                href={`/projects/${projectId}/research/data/${latestCompletedJob.id}?runId=${latestCompletedJob.runId ?? latestCompletedJob.id}`}
                className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
              >
                View Product Data
              </Link>
            ) : (
              <button
                disabled
                className="px-4 py-2 bg-gray-600 text-gray-400 rounded opacity-50 cursor-not-allowed text-xs"
              >
                View Product Data
              </button>
            )}

            {latestCompletedJob && (
              <Link
                href={`/projects/${projectId}/research/data/${latestCompletedJob.id}/inputs?runId=${latestCompletedJob.runId ?? latestCompletedJob.id}`}
                className="text-slate-400 hover:text-slate-300 text-xs underline"
              >
                View Input Parameters
              </Link>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Product URL
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-400">
                    Loading jobs...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-500">
                    No product collection jobs yet.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {new Date(job.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 break-all max-w-md">
                      {String(job.payload?.productUrl || "—")}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {job.status === "COMPLETED" ? (
                        <Link
                          href={`/projects/${projectId}/research/data/${job.id}${job.runId ? `?runId=${job.runId}` : ""}`}
                          className="text-sky-400 hover:text-sky-300 text-sm underline"
                        >
                          View Data →
                        </Link>
                      ) : job.status === "RUNNING" || job.status === "PENDING" ? (
                        <button
                          onClick={() => cancelJob(job.id)}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
