"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type ProductItem = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function ProjectProductsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      ),
    [products]
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
        throw new Error(data?.error || "Failed to load products");
      }
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
    } catch (err: any) {
      setError(err?.message || "Failed to delete product");
    } finally {
      setDeletingProductId(null);
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
              View all products in this project and delete any you no longer need.
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
            {sortedProducts.map((product) => (
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
                      {product.createdAt ? dateFormatter.format(new Date(product.createdAt)) : "Unknown"}
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
