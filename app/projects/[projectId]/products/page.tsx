"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

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

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
          <p className="text-label font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Loading products...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white pb-20">
      <div className="border-b border-line bg-transparent backdrop-blur-md px-8 py-6 sticky top-0 z-30">
        <PageHeader
          backHref={`/projects/${projectId}`}
          backLabel="Back to Project"
          title="Product Library"
          description={`View: Product Management | Project: ${projectId.substring(0, 8)}`}
          actions={
            <>
              <StatusChip variant="subtle">
                {sortedProducts.length} Products
              </StatusChip>
              <button
                onClick={() => void loadProducts()}
                className="btn btn-secondary !min-h-[40px] px-6 text-label font-bold uppercase tracking-widest"
              >
                Refresh Products
              </button>
            </>
          }
        />
      </div>

      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        {error && (
          <SectionCard className="flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 border-danger/20 bg-danger/5" padding="sm">
            <p className="text-body-sm font-mono text-danger uppercase tracking-widest">{error}</p>
            <button onClick={() => setError(null)} className="btn btn-secondary !min-h-[32px] px-4 text-label">Close</button>
          </SectionCard>
        )}

        {sortedProducts.length === 0 ? (
          <EmptyState title="No products have been added to this project yet." />
        ) : (
          <div className="grid gap-8">
            {sortedProducts.map((product) => (
              <SectionCard
                key={product.id}
                padding="none"
                className={`backdrop-blur-panel transition-all duration-300 ${
                  editingProductId === product.id 
                    ? ""
                    : "hover:border-line/60"
                }`}
              >
                <div className="px-6 py-4 border-b border-line/50 bg-bg-elevated flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="eyebrow !mb-0">Product Record</span>
                    <div className="h-3 w-px bg-line/50" />
                    <span className="text-label-sm font-mono text-accent-2/60 uppercase tracking-widest">{product.id}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-label-sm font-mono text-muted uppercase tracking-widest">
                       Added: {product.createdAt ? dateFormatter.format(new Date(product.createdAt)) : "N/A"}
                    </span>
                  </div>
                </div>

                <div className="p-8">
                  <div className="flex flex-col lg:flex-row justify-between gap-8">
                    <div className="space-y-6 flex-1">
                      <div className="space-y-1">
                        <p className="text-xl font-bold text-white tracking-tight">
                          {product.name}
                        </p>
                        {product.amazonAsin && (
                          <p className="text-label font-mono text-muted uppercase tracking-[0.33em] pt-1 opacity-60">
                            ASIN: {product.amazonAsin}
                          </p>
                        )}
                      </div>

                      {product.productProblemSolved && (
                        <div className="p-4 rounded border border-line/30 bg-transparent">
                          <p className="text-label-sm font-mono text-accent uppercase tracking-widest mb-1 opacity-70">Primary Problem</p>
                          <p className="text-sm text-muted leading-relaxed line-clamp-2 italic">&quot;{product.productProblemSolved}&quot;</p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3 pt-2">
                        <button
                          onClick={() => editingProductId === product.id ? cancelEditProduct() : beginEditProduct(product)}
                          className="btn btn-secondary !min-h-[36px] px-6"
                        >
                          {editingProductId === product.id ? "Close Editor" : "Edit Product"}
                        </button>
                        
                        <div className="h-9 w-px bg-line/50 mx-2 hidden sm:block"></div>

                        <Link
                          href={`/products/${product.id}`}
                          className="btn btn-secondary !min-h-[36px] px-6"
                        >
                          Character Creation
                        </Link>

                        <button
                          onClick={() => void handleDeleteProduct(product.id)}
                          disabled={deletingProductId === product.id}
                          className="ml-auto btn btn-danger !min-h-[36px] px-6 disabled:opacity-50"
                        >
                          {deletingProductId === product.id ? "Deleting..." : "Delete Product"}
                        </button>
                      </div>
                    </div>

                    <div className="w-full lg:w-48 aspect-square rounded-card border border-line bg-bg overflow-hidden group/thumb relative">
                      {product.productReferenceImageUrl ? (
                        <>
                          <img 
                            src={product.productReferenceImageUrl} 
                            alt={product.name}
                            className="w-full h-full object-cover transition-all duration-700 scale-100 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-accent-2/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3 opacity-30">
                          <div className="w-10 h-10 border border-line rounded flex items-center justify-center text-xl">🖼️</div>
                          <span className="text-label-sm font-mono uppercase tracking-[0.2em] leading-tight">No Image</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {editingProductId === product.id && editingDraft && (
                    <div className="mt-8 pt-8 border-t border-line/50 animate-in fade-in slide-in-from-top-4 duration-500">
                      <SectionCard className="space-y-8 border-accent/20 bg-accent/5" padding="lg">
                        <div className="grid gap-8 lg:grid-cols-2">
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-label font-mono text-muted uppercase tracking-widest font-bold">Product Name</label>
                              <input
                                value={editingDraft.name}
                                onChange={(event) => setEditingDraft((prev) => prev ? { ...prev, name: event.target.value } : prev)}
                                className="w-full h-12 bg-panel border-line rounded-card px-4 text-sm font-medium text-white focus:border-accent/60 focus:ring-1 focus:ring-accent/60 outline-none transition-all"
                                placeholder="Universal Identity..."
                              />
                            </div>
                            
                            <div className="space-y-3">
                              <label className="text-label font-mono text-muted uppercase tracking-widest font-bold block">Product Image</label>
                              <div className="flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const input = document.getElementById(`product-ref-upload-${product.id}`) as HTMLInputElement | null;
                                    input?.click();
                                  }}
                                  disabled={uploadingReferenceProductId === product.id}
                                  className="btn btn-secondary !min-h-[36px] px-6 text-label disabled:opacity-40"
                                >
                                  {uploadingReferenceProductId === product.id ? "Uploading..." : "Upload Image"}
                                </button>
                                
                                {editingDraft.productReferenceImageUrl && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteProductReferenceImage(product.id)}
                                    disabled={deletingReferenceProductId === product.id}
                                    className="btn btn-danger !min-h-[36px] px-6 text-label"
                                  >
                                    Remove Image
                                  </button>
                                )}
                                
                                <input
                                  id={`product-ref-upload-${product.id}`}
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  disabled={uploadingReferenceProductId === product.id}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void handleUploadProductReferenceImage(product.id, file);
                                    event.currentTarget.value = "";
                                  }}
                                />
                              </div>
                              <p className="text-label-sm font-mono text-muted/40 uppercase tracking-widest">Supports: JPG, PNG, WEBP [Max 10MB]</p>
                            </div>
                          </div>

                          <div className="rounded-card border border-line bg-bg p-4 flex flex-col items-center justify-center text-center space-y-4">
                            {editingDraft.productReferenceImageUrl ? (
                              <img 
                                src={editingDraft.productReferenceImageUrl} 
                                className="max-h-48 rounded border border-line shadow-2xl" 
                                alt="Preview"
                              />
                            ) : (
                              <div className="py-12 opacity-20">
                                <span className="text-label font-mono uppercase tracking-[0.3em]">No image uploaded</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-line/50">
                          <button
                            onClick={cancelEditProduct}
                            disabled={savingProductId === product.id}
                            className="btn btn-secondary !min-h-[40px] px-8 text-label font-bold uppercase tracking-widest"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => void saveEditedProduct(product.id)}
                            disabled={savingProductId === product.id}
                            className="btn btn-primary !min-h-[40px] px-10 text-label font-bold uppercase tracking-widest"
                          >
                            {savingProductId === product.id ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </SectionCard>
                    </div>
                  )}
                </div>
              </SectionCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
