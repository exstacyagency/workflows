"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ProductItem = {
  id: string;
  name: string;
  createdAt?: string;
};

type Props = {
  projectId: string;
  initialProducts: ProductItem[];
};

export function ProjectProductsPanel({ projectId, initialProducts }: Props) {
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const hasProducts = products.length > 0;
  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      ),
    [products]
  );

  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create product");
      }
      if (data?.product) {
        setProducts((prev) => [data.product, ...prev]);
        setSelectedProductId(data.product.id);
      }
      setName("");
      if (createDetailsRef.current) {
        createDetailsRef.current.open = false;
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create product");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Products</h2>
          <p className="text-xs text-slate-400">
            Create/select a product before opening Research Hub or Creative Studio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              disabled={!hasProducts}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 disabled:text-slate-500"
            >
              {!hasProducts && <option value="">No products yet</option>}
              {sortedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <Link
              href={
                selectedProductId
                  ? `/projects/${projectId}/research-hub?productId=${selectedProductId}`
                  : "#"
              }
              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                selectedProductId
                  ? "bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "bg-slate-900 text-slate-500 cursor-not-allowed pointer-events-none"
              }`}
              aria-disabled={!selectedProductId}
            >
              Research Hub
            </Link>
            <Link
              href={
                selectedProductId
                  ? `/projects/${projectId}/creative-studio?productId=${selectedProductId}`
                  : "#"
              }
              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                selectedProductId
                  ? "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                  : "border border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed pointer-events-none"
              }`}
              aria-disabled={!selectedProductId}
            >
              Creative Studio
            </Link>
          </div>
        </div>
      </div>

      {!hasProducts ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-6 text-center">
          <p className="text-sm text-slate-300 mb-2">No products created yet.</p>
          <p className="text-xs text-slate-500 mb-4">
            Add your first product to start research and creative workflows.
          </p>
        </div>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <details
        ref={createDetailsRef}
        className="rounded-xl border border-slate-700 bg-slate-900/80"
      >
        <summary className="list-none select-none px-4 py-3">
          <span className="inline-flex items-center justify-center rounded-md bg-sky-500 hover:bg-sky-400 px-3 py-2 text-xs font-medium text-white">
            Create New Product
          </span>
        </summary>
        <div className="border-t border-slate-800 p-4">
          <form onSubmit={handleCreateProduct} className="space-y-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Product Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                placeholder="e.g., ClearGlow Serum"
                required
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!submitting && createDetailsRef.current) {
                    createDetailsRef.current.open = false;
                    setError(null);
                  }
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
              >
                {submitting ? "Creating..." : "Create Product"}
              </button>
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}
