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

  useEffect(() => {
    if (selectedProductId && !products.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(products[0]?.id || "");
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
    <section className="rounded-card border border-line bg-panel p-5 space-y-4 shadow-panel backdrop-blur-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-tight">Products</h2>
          <p className="text-xs text-muted italic">
            Create or select a product to begin research and creative workflows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col items-start gap-2">
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              disabled={!hasProducts}
              className="rounded-pill border border-line bg-panel px-3 py-1 text-xs text-text disabled:opacity-50 outline-none focus:border-accent/40 transition-colors"
            >
              {!hasProducts && <option value="">No products yet</option>}
              {sortedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}/products`}
              className="inline-flex items-center rounded-pill border border-line bg-bg-elevated px-4 py-1.5 text-xs font-medium text-muted hover:text-white hover:bg-panel-strong transition-all"
            >
              View All Products
            </Link>
          </div>
        </div>
      </div>

      {!hasProducts && (
        <div className="rounded-card border border-line bg-panel p-6 text-center">
          <p className="text-sm text-text mb-2">No products created yet.</p>
          <p className="text-xs text-muted mb-4 italic">
            Add your first product to start research and creative workflows.
          </p>
        </div>
      )}

      <details
        ref={createDetailsRef}
        className="rounded-card border border-line bg-panel overflow-hidden"
      >
        <summary className="list-none select-none px-4 py-3 cursor-pointer hover:bg-panel/[0.02] transition-colors">
          <span className="inline-flex items-center justify-center rounded-pill bg-accent hover:bg-accent/90 px-4 py-2 text-xs font-bold text-bg shadow-[0_0_15px_rgba(232,209,122,0.15)] transition-all">
            + Create New Product
          </span>
        </summary>
        <div className="border-t border-line p-5">
          <form onSubmit={handleCreateProduct} className="space-y-4">
            <div>
              <label className="block text-[11px] font-mono text-muted uppercase tracking-wider mb-2">Product Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-pill border border-line bg-panel px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors"
                placeholder="e.g., ClearGlow Serum"
                required
              />
            </div>
            {error && <p className="text-xs text-accent">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!submitting && createDetailsRef.current) {
                    createDetailsRef.current.open = false;
                    setError(null);
                  }
                }}
                className="rounded-pill border border-line bg-transparent px-4 py-2 text-xs font-medium text-muted hover:text-white hover:bg-transparent transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-pill bg-accent px-5 py-2 text-xs font-bold text-bg hover:bg-accent/90 disabled:opacity-50 shadow-[0_0_15px_rgba(232,209,122,0.15)] transition-all"
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
