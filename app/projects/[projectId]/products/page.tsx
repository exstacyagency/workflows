"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type ProductItem = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
  creatorReferenceImageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type CreatorLibraryEntry = {
  id: string;
  productId: string;
  imageUrl: string;
  prompt: string;
  isActive: boolean;
  createdAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  return fallback;
}

export default function ProjectProductsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [creatorLibrariesByProduct, setCreatorLibrariesByProduct] = useState<
    Record<string, CreatorLibraryEntry[]>
  >({});
  const [libraryLoadingByProduct, setLibraryLoadingByProduct] = useState<Record<string, boolean>>({});
  const [libraryErrorByProduct, setLibraryErrorByProduct] = useState<Record<string, string | null>>({});
  const [activatingLibraryId, setActivatingLibraryId] = useState<string | null>(null);
  const [creatorModalProductId, setCreatorModalProductId] = useState<string | null>(null);
  const [creatorDescription, setCreatorDescription] = useState("");
  const [creatorModalSubmitting, setCreatorModalSubmitting] = useState(false);
  const [creatorModalError, setCreatorModalError] = useState<string | null>(null);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [products],
  );

  const selectedModalProduct = useMemo(
    () => products.find((product) => product.id === creatorModalProductId) ?? null,
    [creatorModalProductId, products],
  );

  const loadCreatorLibrary = useCallback(async (productId: string) => {
    setLibraryLoadingByProduct((prev) => ({ ...prev, [productId]: true }));
    setLibraryErrorByProduct((prev) => ({ ...prev, [productId]: null }));

    try {
      const res = await fetch(`/api/products/${productId}/creator/library`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, "Failed to load creator library"));
      }

      const entries = Array.isArray(data?.entries)
        ? (data.entries as CreatorLibraryEntry[])
        : [];
      setCreatorLibrariesByProduct((prev) => ({ ...prev, [productId]: entries }));

      if (typeof data?.creatorReferenceImageUrl === "string" || data?.creatorReferenceImageUrl === null) {
        setProducts((prev) =>
          prev.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  creatorReferenceImageUrl: data.creatorReferenceImageUrl,
                }
              : product,
          ),
        );
      }
    } catch (err: any) {
      setLibraryErrorByProduct((prev) => ({
        ...prev,
        [productId]: err?.message || "Failed to load creator library",
      }));
    } finally {
      setLibraryLoadingByProduct((prev) => ({ ...prev, [productId]: false }));
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/products`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load products");
      }
      const productList = Array.isArray(data.products) ? (data.products as ProductItem[]) : [];
      setProducts(productList);

      productList.forEach((product) => {
        void loadCreatorLibrary(product.id);
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [loadCreatorLibrary, projectId]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  async function handleDeleteProduct(productId: string) {
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    setDeletingProductId(productId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/products`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete product");
      }
      setProducts((prev) => prev.filter((product) => product.id !== productId));
      setCreatorLibrariesByProduct((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      setLibraryErrorByProduct((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    } catch (err: any) {
      setError(err?.message || "Failed to delete product");
    } finally {
      setDeletingProductId(null);
    }
  }

  async function handleSetActiveCreatorFace(productId: string, libraryId: string) {
    setActivatingLibraryId(libraryId);
    setError(null);

    try {
      const res = await fetch(`/api/products/${productId}/creator/library`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(extractErrorMessage(data, "Failed to set active creator face"));
      }

      const entries = Array.isArray(data?.entries)
        ? (data.entries as CreatorLibraryEntry[])
        : [];
      setCreatorLibrariesByProduct((prev) => ({ ...prev, [productId]: entries }));
      setProducts((prev) =>
        prev.map((product) =>
          product.id === productId
            ? {
                ...product,
                creatorReferenceImageUrl:
                  typeof data?.creatorReferenceImageUrl === "string"
                    ? data.creatorReferenceImageUrl
                    : product.creatorReferenceImageUrl ?? null,
              }
            : product,
        ),
      );
    } catch (err: any) {
      setError(err?.message || "Failed to set active creator face");
    } finally {
      setActivatingLibraryId(null);
    }
  }

  async function handleGenerateCreatorFace() {
    if (!creatorModalProductId) return;

    const trimmedDescription = creatorDescription.trim();
    if (!trimmedDescription) {
      setCreatorModalError("Enter a creator description.");
      return;
    }

    setCreatorModalSubmitting(true);
    setCreatorModalError(null);

    try {
      const res = await fetch(`/api/products/${creatorModalProductId}/creator/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorDescription: trimmedDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(extractErrorMessage(data, "Failed to generate creator face"));
      }

      const fallbackEntry: CreatorLibraryEntry = {
        id: String(data?.libraryId || ""),
        productId: creatorModalProductId,
        imageUrl: String(data?.imageUrl || ""),
        prompt: "",
        isActive: false,
        createdAt: new Date().toISOString(),
      };

      const newEntry = (data?.entry as CreatorLibraryEntry | undefined) ?? fallbackEntry;

      setCreatorLibrariesByProduct((prev) => ({
        ...prev,
        [creatorModalProductId]: [newEntry, ...(prev[creatorModalProductId] || [])],
      }));

      setCreatorDescription("");
      setCreatorModalProductId(null);
    } catch (err: any) {
      setCreatorModalError(err?.message || "Failed to generate creator face");
    } finally {
      setCreatorModalSubmitting(false);
    }
  }

  function openCreatorModal(productId: string) {
    setCreatorModalProductId(productId);
    setCreatorDescription("");
    setCreatorModalError(null);
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Project</p>
            <h1 className="text-2xl font-semibold text-slate-50">All Products</h1>
            <p className="text-sm text-slate-400 mt-1">
              View all products in this project and manage creator references for image generation.
            </p>
          </div>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Back to Project
          </Link>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-100">Products</h2>
          <span className="text-xs text-slate-500">
            {sortedProducts.length} {sortedProducts.length === 1 ? "product" : "products"}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading products...</p>
        ) : sortedProducts.length === 0 ? (
          <p className="text-sm text-slate-400">No products created yet.</p>
        ) : (
          <div className="space-y-3">
            {sortedProducts.map((product) => {
              const libraryEntries = creatorLibrariesByProduct[product.id] || [];
              const libraryError = libraryErrorByProduct[product.id];
              const libraryLoading = libraryLoadingByProduct[product.id] === true;

              return (
                <div
                  key={product.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-500">
                        ID: <span className="font-mono">{product.id}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-100">{product.name}</div>
                      <div className="text-xs text-slate-500">
                        Created{" "}
                        {product.createdAt
                          ? dateFormatter.format(new Date(product.createdAt))
                          : "Unknown"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/projects/${projectId}/research-hub?productId=${product.id}`}
                        className="inline-flex items-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white"
                      >
                        Research Hub
                      </Link>
                      <Link
                        href={`/projects/${projectId}/creative-studio?productId=${product.id}`}
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        Creative Studio
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleDeleteProduct(product.id)}
                        disabled={deletingProductId === product.id}
                        className={`inline-flex items-center rounded-md border px-3 py-2 text-xs font-medium ${
                          deletingProductId === product.id
                            ? "border-slate-700 bg-slate-900 text-slate-500 cursor-not-allowed"
                            : "border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        }`}
                      >
                        {deletingProductId === product.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Creator</h3>
                      <button
                        type="button"
                        onClick={() => openCreatorModal(product.id)}
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        Generate New
                      </button>
                    </div>

                    {product.creatorReferenceImageUrl ? (
                      <div>
                        <div className="text-xs text-slate-400 mb-2">Active face</div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={product.creatorReferenceImageUrl}
                          alt={`${product.name} active creator face`}
                          className="h-40 w-40 rounded-md border-2 border-emerald-500 object-cover"
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-amber-300">
                        No active creator face selected. Generate one and set it active to unlock image generation.
                      </p>
                    )}

                    {libraryError && <p className="text-xs text-red-300">{libraryError}</p>}
                    {libraryLoading && libraryEntries.length === 0 ? (
                      <p className="text-xs text-slate-500">Loading creator library...</p>
                    ) : libraryEntries.length === 0 ? (
                      <p className="text-xs text-slate-500">No creator faces yet.</p>
                    ) : (
                      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                        {libraryEntries.map((entry) => {
                          const isActive = entry.isActive;
                          const isPending = activatingLibraryId === entry.id;
                          return (
                            <div
                              key={entry.id}
                              className={`rounded-md border p-2 ${
                                isActive
                                  ? "border-emerald-500 bg-emerald-500/10"
                                  : "border-slate-700 bg-slate-950"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={entry.imageUrl}
                                alt="Creator library image"
                                className="h-28 w-full rounded-md object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSetActiveCreatorFace(product.id, entry.id)}
                                disabled={isActive || isPending}
                                className={`mt-2 w-full rounded-md px-2 py-1 text-xs font-medium ${
                                  isActive
                                    ? "bg-emerald-500/20 text-emerald-300 cursor-default"
                                    : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                                }`}
                              >
                                {isPending ? "Saving..." : isActive ? "Active" : "Set Active"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {creatorModalProductId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">Generate Creator Face</h2>
            <p className="text-xs text-slate-400">
              {selectedModalProduct
                ? `Product: ${selectedModalProduct.name}`
                : "Describe the creator face you want to generate."}
            </p>
            <textarea
              value={creatorDescription}
              onChange={(event) => setCreatorDescription(event.target.value)}
              placeholder="Describe age range, style, attire, and tone..."
              className="w-full min-h-[120px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              disabled={creatorModalSubmitting}
            />
            {creatorModalError && <p className="text-xs text-red-300">{creatorModalError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!creatorModalSubmitting) {
                    setCreatorModalProductId(null);
                    setCreatorDescription("");
                    setCreatorModalError(null);
                  }
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                disabled={creatorModalSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateCreatorFace()}
                className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
                disabled={creatorModalSubmitting}
              >
                {creatorModalSubmitting ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
