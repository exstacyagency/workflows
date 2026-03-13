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
  productReferenceImageUrl?: string | null;
  characterReferenceVideoUrl?: string | null;
  soraCharacterId?: string | null;
  characterCameoCreatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ProductEditDraft = {
  name: string;
  productReferenceImageUrl: string;
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

function makeEditDraft(product: ProductItem): ProductEditDraft {
  return {
    name: String(product.name ?? ""),
    productReferenceImageUrl: String(product.productReferenceImageUrl ?? ""),
  };
}

export default function ProjectProductsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ProductEditDraft | null>(null);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [uploadingReferenceProductId, setUploadingReferenceProductId] = useState<string | null>(null);
  const [deletingReferenceProductId, setDeletingReferenceProductId] = useState<string | null>(null);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [products],
  );

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
        throw new Error(extractErrorMessage(data, "Failed to load products"));
      }
      const productList = Array.isArray(data.products) ? (data.products as ProductItem[]) : [];
      setProducts(productList);
    } catch (err: any) {
      setError(err?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

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
        throw new Error(extractErrorMessage(data, "Failed to delete product"));
      }
      setProducts((prev) => prev.filter((product) => product.id !== productId));
    } catch (err: any) {
      setError(err?.message || "Failed to delete product");
    } finally {
      setDeletingProductId(null);
    }
  }

  async function handleUploadProductReferenceImage(productId: string, file: File) {
    if (!editingDraft || uploadingReferenceProductId) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Invalid file type. Accepted types: image/jpeg, image/png, image/webp.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large. Max size is 10.0MB.");
      return;
    }

    setUploadingReferenceProductId(productId);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("file", file);

      const res = await fetch(`/api/projects/${projectId}/products/upload-reference`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || typeof data?.url !== "string") {
        throw new Error(extractErrorMessage(data, "Failed to upload product reference image"));
      }
      const uploadedUrl = String(data.url);

      setEditingDraft((prev) =>
        prev ? { ...prev, productReferenceImageUrl: uploadedUrl } : prev,
      );

      const patchRes = await fetch(`/api/projects/${projectId}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          productReferenceImageUrl: uploadedUrl,
        }),
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok || !patchData?.success || !patchData?.product) {
        throw new Error(
          extractErrorMessage(patchData, "Uploaded image but failed to save product reference URL"),
        );
      }

      const updatedProduct = patchData.product as ProductItem;
      setProducts((prev) =>
        prev.map((product) => (product.id === productId ? updatedProduct : product)),
      );
    } catch (err: any) {
      setError(err?.message || "Failed to upload product reference image");
    } finally {
      setUploadingReferenceProductId(null);
    }
  }

  async function handleDeleteProductReferenceImage(productId: string) {
    if (deletingReferenceProductId) return;

    setDeletingReferenceProductId(productId);
    setError(null);

    try {
      const patchRes = await fetch(`/api/projects/${projectId}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          productReferenceImageUrl: null,
        }),
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok || !patchData?.success || !patchData?.product) {
        throw new Error(
          extractErrorMessage(patchData, "Failed to delete product reference URL"),
        );
      }

      const updatedProduct = patchData.product as ProductItem;
      setProducts((prev) =>
        prev.map((product) => (product.id === productId ? updatedProduct : product)),
      );
      setEditingDraft((prev) =>
        prev ? { ...prev, productReferenceImageUrl: "" } : prev,
      );
    } catch (err: any) {
      setError(err?.message || "Failed to delete product reference URL");
    } finally {
      setDeletingReferenceProductId(null);
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
              Manage product references and Sora character setup.
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
          <div className="space-y-4">
            {sortedProducts.map((product) => {
              return (
                <div
                  key={product.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 space-y-4"
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

                    <div className="flex gap-2 flex-wrap justify-end">
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
                        href={`/products/${product.id}`}
                        className="inline-flex items-center rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-xs font-medium text-white"
                      >
                        Product Setup
                      </Link>
                      <Link
                        href={`/projects/${projectId}/research-hub?productId=${product.id}`}
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
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
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-1">
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
                      </div>

                      <div className="grid gap-3 md:grid-cols-1">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-300">
                            Product Reference Image
                          </label>
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                const input = document.getElementById(
                                  `product-ref-upload-${product.id}`,
                                ) as HTMLInputElement | null;
                                input?.click();
                              }}
                              disabled={uploadingReferenceProductId === product.id}
                              className="inline-flex cursor-pointer items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {uploadingReferenceProductId === product.id
                                ? "Uploading..."
                                : "Upload Product Image"}
                            </button>
                            <input
                              id={`product-ref-upload-${product.id}`}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              style={{
                                position: "absolute",
                                width: 1,
                                height: 1,
                                padding: 0,
                                margin: -1,
                                overflow: "hidden",
                                clip: "rect(0, 0, 0, 0)",
                                whiteSpace: "nowrap",
                                border: 0,
                              }}
                              tabIndex={-1}
                              aria-hidden="true"
                              disabled={uploadingReferenceProductId === product.id}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  void handleUploadProductReferenceImage(product.id, file);
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                          </div>
                          <p className="text-[11px] text-amber-300">
                            Accepted types: image/jpeg, image/png, image/webp; Max size: 10.0MB
                          </p>
                          {editingDraft.productReferenceImageUrl ? (
                            <div className="space-y-2">
                              <p className="text-[11px] text-slate-400 break-all">
                                Uploaded URL: {editingDraft.productReferenceImageUrl}
                              </p>
                              <button
                                type="button"
                                onClick={() => void handleDeleteProductReferenceImage(product.id)}
                                disabled={deletingReferenceProductId === product.id}
                                className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingReferenceProductId === product.id
                                  ? "Deleting..."
                                  : "Delete Product Image URL"}
                              </button>
                            </div>
                          ) : null}
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
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
