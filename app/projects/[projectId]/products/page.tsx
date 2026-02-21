"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductItem = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ProductEditDraft = {
  name: string;
  productProblemSolved: string;
  amazonAsin: string;
  creatorReferenceImageUrl: string;
  productReferenceImageUrl: string;
};

type CreatorLibraryEntry = {
  id: string;
  productId: string;
  imageUrl: string;
  prompt: string;
  isActive: boolean;
  createdAt: string;
};

type AvatarSeedState =
  | {
      status: "loading";
      message?: string;
      creatorDescription?: string;
    }
  | {
      status: "available";
      message?: string;
      creatorDescription: string;
    }
  | {
      status: "unavailable";
      message: string;
      creatorDescription?: string;
    };

type ImagePreviewState = {
  url: string;
  alt: string;
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
  const [previewImage, setPreviewImage] = useState<ImagePreviewState | null>(null);
  const [creatorDescription, setCreatorDescription] = useState("");
  const [creatorAvatarLoading, setCreatorAvatarLoading] = useState(false);
  const [avatarSeedByProduct, setAvatarSeedByProduct] = useState<Record<string, AvatarSeedState>>({});
  const avatarSeedByProductRef = useRef<Record<string, AvatarSeedState>>(avatarSeedByProduct);
  const [creatorModalSubmitting, setCreatorModalSubmitting] = useState(false);
  const [creatorModalError, setCreatorModalError] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ProductEditDraft | null>(null);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);

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

  const openPreviewImage = useCallback((url: string, alt: string) => {
    console.log("[creator.library] Preview click", {
      timestamp: new Date().toISOString(),
      url,
      alt,
    });
    setPreviewImage({ url, alt });
  }, []);

  useEffect(() => {
    avatarSeedByProductRef.current = avatarSeedByProduct;
  }, [avatarSeedByProduct]);

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

  async function handleUseCustomerAvatar() {
    if (!creatorModalProductId || creatorAvatarLoading) return;
    const cached = avatarSeedByProduct[creatorModalProductId];
    if (cached?.status === "unavailable") {
      setCreatorModalError(cached.message || "Run customer research first");
      return;
    }
    if (cached?.status === "available" && cached.creatorDescription.trim()) {
      setCreatorDescription(cached.creatorDescription.trim());
      setCreatorModalError(null);
      return;
    }

    setCreatorAvatarLoading(true);
    setCreatorModalError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/customer-avatar?productId=${encodeURIComponent(creatorModalProductId)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const apiMessage = extractErrorMessage(
          data,
          `Failed to load customer avatar (HTTP ${res.status})`,
        );
        throw new Error(apiMessage);
      }

      const suggested = String(data?.creatorDescription ?? "").trim();
      if (!suggested) {
        throw new Error("Customer avatar did not include usable creator description fields.");
      }
      setAvatarSeedByProduct((prev) => ({
        ...prev,
        [creatorModalProductId]: {
          status: "available",
          creatorDescription: suggested,
        },
      }));
      setCreatorDescription(suggested);
    } catch (err: any) {
      console.error("[creator.modal] Failed to use customer avatar", {
        projectId,
        productId: creatorModalProductId,
        error: err,
      });
      const message = err?.message || "Failed to load customer avatar";
      setCreatorModalError(message);
    } finally {
      setCreatorAvatarLoading(false);
    }
  }

  function openCreatorModal(productId: string) {
    setCreatorModalProductId(productId);
    setCreatorDescription("");
    setCreatorModalError(null);
  }

  useEffect(() => {
    const productId = creatorModalProductId;
    if (!productId) return;
    const existing = avatarSeedByProductRef.current[productId];
    console.log("[creator.modal] Avatar pre-check effect start", {
      timestamp: new Date().toISOString(),
      productId,
      avatarSeedState: existing,
      avatarSeedByProduct: avatarSeedByProductRef.current,
    });
    if (
      existing?.status === "available" ||
      existing?.status === "unavailable" ||
      existing?.status === "loading"
    ) {
      console.log("[creator.modal] Avatar pre-check skipped due existing state", {
        timestamp: new Date().toISOString(),
        productId,
        avatarSeedState: existing,
      });
      return;
    }

    let cancelled = false;
    const timeoutMs = 5000;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      console.log("[creator.modal] Avatar pre-check timeout fired", {
        timestamp: new Date().toISOString(),
        productId,
        timeoutMs,
      });
      abortController.abort("Customer avatar pre-check timed out after 5 seconds");
    }, timeoutMs);
    let resolved = false;

    const setResolvedSeedState = (nextState: AvatarSeedState) => {
      if (cancelled) return;
      resolved = true;
      setAvatarSeedByProduct((prev) => ({
        ...prev,
        [productId]: nextState,
      }));
    };

    setAvatarSeedByProduct((prev) => ({
      ...prev,
      [productId]: { status: "loading" },
    }));

    void (async () => {
      try {
        console.log("[creator.modal] Avatar pre-check fetch start", {
          timestamp: new Date().toISOString(),
          productId,
        });
        const res = await fetch(
          `/api/projects/${projectId}/customer-avatar?productId=${encodeURIComponent(productId)}`,
          { cache: "no-store", signal: abortController.signal },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.log("[creator.modal] Avatar pre-check fetch completed with non-OK response", {
            timestamp: new Date().toISOString(),
            productId,
            status: res.status,
            data,
          });
          const apiMessage = extractErrorMessage(
            data,
            `Failed to load customer avatar (HTTP ${res.status})`,
          );
          const noAvatarSeedData =
            res.status === 404 ||
            /no customer research found for this product/i.test(apiMessage) ||
            /no avatar data for this product/i.test(apiMessage);
          setResolvedSeedState(
            noAvatarSeedData
              ? {
                  status: "unavailable",
                  message: apiMessage || "Run customer research first",
                }
              : {
                  status: "available",
                  creatorDescription: "",
                  message: apiMessage || "Failed to load customer avatar",
                },
          );
          return;
        }

        console.log("[creator.modal] Avatar pre-check fetch completed successfully", {
          timestamp: new Date().toISOString(),
          productId,
          data,
        });
        const suggested = String(data?.creatorDescription ?? "").trim();
        if (!suggested) {
          setResolvedSeedState({
            status: "unavailable",
            message: "Latest customer analysis has no avatar data for this product",
          });
          return;
        }

        setResolvedSeedState({
          status: "available",
          creatorDescription: suggested,
        });
      } catch (error: any) {
        console.log("[creator.modal] Avatar pre-check fetch failed", {
          timestamp: new Date().toISOString(),
          projectId,
          productId,
          error,
        });
        console.error("[creator.modal] Failed to pre-check customer avatar availability", {
          projectId,
          productId,
          error,
        });
        const timeoutMessage =
          error?.name === "AbortError"
            ? "Customer avatar pre-check timed out. You can still try manually."
            : error?.message || "Failed to load customer avatar";
        setResolvedSeedState({
          status: "available",
          creatorDescription: "",
          message: timeoutMessage,
        });
      } finally {
        console.log("[creator.modal] Avatar pre-check finally", {
          timestamp: new Date().toISOString(),
          productId,
          cancelled,
          resolved,
        });
        window.clearTimeout(timeoutId);
        if (!cancelled && !resolved) {
          setAvatarSeedByProduct((prev) => ({
            ...prev,
            [productId]: {
              status: "available",
              creatorDescription: "",
            },
          }));
        }
      }
    })();

    return () => {
      console.log("[creator.modal] Avatar pre-check cleanup", {
        timestamp: new Date().toISOString(),
        productId,
      });
      cancelled = true;
      window.clearTimeout(timeoutId);
      try {
        abortController.abort("Pre-check cancelled");
      } catch (error) {
        console.error("[creator.modal] Failed to abort customer avatar pre-check", {
          projectId,
          productId,
          error,
        });
      }
    };
  }, [creatorModalProductId, projectId]);

  useEffect(() => {
    if (!creatorModalProductId) return;
    const avatarSeedState = avatarSeedByProduct[creatorModalProductId];
    const isAvatarSeedUnavailable = avatarSeedState?.status === "unavailable";
    const isAvatarSeedLoading = avatarSeedState?.status === "loading";
    const useAvatarDisabled =
      creatorModalSubmitting ||
      creatorAvatarLoading ||
      isAvatarSeedLoading ||
      isAvatarSeedUnavailable;
    const disableReasons: string[] = [];
    if (creatorModalSubmitting) disableReasons.push("creatorModalSubmitting");
    if (creatorAvatarLoading) disableReasons.push("creatorAvatarLoading");
    if (isAvatarSeedLoading) disableReasons.push("avatarSeedLoading");
    if (isAvatarSeedUnavailable) disableReasons.push("avatarSeedUnavailable");
    console.log("[creator.modal] Use Customer Avatar button state", {
      timestamp: new Date().toISOString(),
      productId: creatorModalProductId,
      useAvatarDisabled,
      disableReasons,
      avatarSeedState,
    });
  }, [avatarSeedByProduct, creatorModalProductId, creatorModalSubmitting, creatorAvatarLoading]);

  function makeEditDraft(product: ProductItem): ProductEditDraft {
    return {
      name: String(product.name ?? ""),
      productProblemSolved: String(product.productProblemSolved ?? ""),
      amazonAsin: String(product.amazonAsin ?? ""),
      creatorReferenceImageUrl: String(product.creatorReferenceImageUrl ?? ""),
      productReferenceImageUrl: String(product.productReferenceImageUrl ?? ""),
    };
  }

  function beginEditProduct(product: ProductItem) {
    setEditingProductId(product.id);
    setEditingDraft(makeEditDraft(product));
  }

  function cancelEditProduct() {
    setEditingProductId(null);
    setEditingDraft(null);
  }

  async function saveEditedProduct(productId: string) {
    if (!editingDraft || savingProductId) return;
    setSavingProductId(productId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          name: editingDraft.name.trim(),
          productProblemSolved: editingDraft.productProblemSolved,
          amazonAsin: editingDraft.amazonAsin,
          creatorReferenceImageUrl: editingDraft.creatorReferenceImageUrl,
          productReferenceImageUrl: editingDraft.productReferenceImageUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.product) {
        throw new Error(extractErrorMessage(data, "Failed to update product"));
      }
      const updated = data.product as ProductItem;
      setProducts((prev) => prev.map((product) => (product.id === productId ? updated : product)));
      setEditingProductId(null);
      setEditingDraft(null);
    } catch (err: any) {
      setError(err?.message || "Failed to update product");
    } finally {
      setSavingProductId(null);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Project</p>
            <h1 className="text-2xl font-semibold text-slate-50">All Products</h1>
            <p className="text-sm text-slate-400 mt-1">
              View all products in this project and manage creator/product reference images.
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
                      <button
                        type="button"
                        onClick={() =>
                          editingProductId === product.id
                            ? cancelEditProduct()
                            : beginEditProduct(product)
                        }
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        {editingProductId === product.id ? "Close Edit" : "Edit"}
                      </button>
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

                  {editingProductId === product.id && editingDraft && (
                    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-300">Name</label>
                          <input
                            value={editingDraft.name}
                            onChange={(event) =>
                              setEditingDraft((prev) =>
                                prev ? { ...prev, name: event.target.value } : prev,
                              )
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-300">Amazon ASIN</label>
                          <input
                            value={editingDraft.amazonAsin}
                            onChange={(event) =>
                              setEditingDraft((prev) =>
                                prev ? { ...prev, amazonAsin: event.target.value } : prev,
                              )
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                            placeholder="Optional"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-300">
                          Problem Solved
                        </label>
                        <textarea
                          value={editingDraft.productProblemSolved}
                          onChange={(event) =>
                            setEditingDraft((prev) =>
                              prev ? { ...prev, productProblemSolved: event.target.value } : prev,
                            )
                          }
                          className="w-full min-h-[70px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          placeholder="Optional"
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-300">
                            Creator Reference Image URL
                          </label>
                          <input
                            value={editingDraft.creatorReferenceImageUrl}
                            onChange={(event) =>
                              setEditingDraft((prev) =>
                                prev
                                  ? { ...prev, creatorReferenceImageUrl: event.target.value }
                                  : prev,
                              )
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                            placeholder="https://..."
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-300">
                            Product Reference Image URL
                          </label>
                          <input
                            value={editingDraft.productReferenceImageUrl}
                            onChange={(event) =>
                              setEditingDraft((prev) =>
                                prev
                                  ? { ...prev, productReferenceImageUrl: event.target.value }
                                  : prev,
                              )
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                            placeholder="https://..."
                          />
                          {editingDraft.productReferenceImageUrl.trim() && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={editingDraft.productReferenceImageUrl}
                              alt="Product reference preview"
                              className="h-24 w-full rounded-md border border-slate-700 object-cover"
                            />
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEditProduct}
                          disabled={savingProductId === product.id}
                          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEditedProduct(product.id)}
                          disabled={savingProductId === product.id}
                          className="rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-60"
                        >
                          {savingProductId === product.id ? "Saving..." : "Save Product"}
                        </button>
                      </div>
                    </div>
                  )}

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
                        <p className="text-xs text-emerald-300">
                          Active creator face selected. Use the thumbnail grid to preview.
                        </p>
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
                        {libraryEntries.map((entry, index) => {
                          const isActive = entry.isActive;
                          const isPending = activatingLibraryId === entry.id;
                          const isPreviewOpen = previewImage?.url === entry.imageUrl;
                          const creatorLabel = `Creator #${index + 1}`;
                          const createdLabel = entry.createdAt
                            ? dateFormatter.format(new Date(entry.createdAt))
                            : "Unknown time";
                          return (
                            <div
                              key={entry.id}
                              className={`relative rounded-md border p-2 ${
                                isActive
                                  ? "border-emerald-500 bg-emerald-500/10"
                                  : "border-slate-700 bg-slate-950"
                              }`}
                            >
                              {isActive && (
                                <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                                  ✓ Active
                                </span>
                              )}
                              <div className="flex h-[200px] w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-900 px-2 text-center">
                                <p className="text-xs font-semibold text-slate-200">{creatorLabel}</p>
                                <p className="mt-1 text-[11px] text-slate-400">Created {createdLabel}</p>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => openPreviewImage(entry.imageUrl, `${product.name} creator face`)}
                                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSetActiveCreatorFace(product.id, entry.id)}
                                  disabled={isActive || isPending}
                                  className={`w-full rounded-md px-2 py-1 text-xs font-medium ${
                                    isActive
                                      ? "bg-emerald-500/20 text-emerald-300 cursor-default"
                                      : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                                  }`}
                                >
                                  {isPending ? "Saving..." : isActive ? "Active" : "Set Active"}
                                </button>
                              </div>
                              {isPreviewOpen ? (
                                <div className="relative mt-2 flex h-[200px] items-center justify-center rounded-md border border-slate-700 bg-slate-900">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewImage(null)}
                                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-sm leading-none text-slate-200 hover:bg-slate-800"
                                    aria-label="Close preview"
                                  >
                                    ×
                                  </button>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={entry.imageUrl}
                                    alt={`${product.name} creator face preview`}
                                    style={{ width: "200px", height: "200px", objectFit: "contain" }}
                                  />
                                </div>
                              ) : null}
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
        (() => {
          const avatarSeedState = avatarSeedByProduct[creatorModalProductId];
          const isAvatarSeedUnavailable = avatarSeedState?.status === "unavailable";
          const isAvatarSeedLoading = avatarSeedState?.status === "loading";
          const useAvatarDisabled =
            creatorModalSubmitting || creatorAvatarLoading || isAvatarSeedLoading || isAvatarSeedUnavailable;
          const useAvatarTooltip = isAvatarSeedUnavailable
            ? avatarSeedState?.message || "Run customer research first"
            : undefined;
          return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">Generate Creator Face</h2>
            <p className="text-xs text-slate-400">
              {selectedModalProduct
                ? `Product: ${selectedModalProduct.name}`
                : "Describe the creator face you want to generate."}
            </p>
            <div className="flex flex-col gap-2 md:flex-row md:items-start">
              <textarea
                value={creatorDescription}
                onChange={(event) => setCreatorDescription(event.target.value)}
                placeholder="Describe age range, style, attire, and tone..."
                className="w-full min-h-[120px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                disabled={creatorModalSubmitting || creatorAvatarLoading}
              />
              <button
                type="button"
                onClick={() => void handleUseCustomerAvatar()}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-60 md:whitespace-nowrap"
                disabled={useAvatarDisabled}
                title={useAvatarTooltip}
              >
                {creatorAvatarLoading || isAvatarSeedLoading ? "Loading Avatar..." : "Use Customer Avatar"}
              </button>
            </div>
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
          );
        })()
      )}
    </div>
  );
}
