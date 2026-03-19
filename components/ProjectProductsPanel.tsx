"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, SectionCard } from "@/components/ui";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <p className="eyebrow">Products</p>
          <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
            Create or select a product to begin research and creative workflows.
          </p>
        </div>
      </div>
      <SectionCard className="space-y-4" padding="sm">
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
              className="btn btn-secondary !min-h-[32px] px-4 text-label"
            >
              View All Products
            </Link>
          </div>
        </div>

        {!hasProducts && (
          <EmptyState
            title="No Products Created Yet"
            description="Add your first product to start research and creative workflows."
          />
        )}

        <SectionCard padding="none" className="overflow-hidden">
          <details
            ref={createDetailsRef}
            className="overflow-hidden"
          >
            <summary className="list-none select-none px-4 py-3 cursor-pointer hover:bg-panel/[0.02] transition-colors">
              <span className="btn btn-primary !min-h-[36px] px-6">
                + Create New Product
              </span>
            </summary>
            <div className="border-t border-line p-5">
              <form onSubmit={handleCreateProduct} className="space-y-4">
                <div>
                  <label className="block text-body-sm font-mono text-muted uppercase tracking-wider mb-2">Product Name</label>
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
                    className="btn btn-secondary !min-h-[32px] px-4 text-label"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary !min-h-[36px] px-6 text-label shadow-panel disabled:opacity-50"
                  >
                    {submitting ? "Creating..." : "Create Product"}
                  </button>
                </div>
              </form>
            </div>
          </details>
        </SectionCard>
      </SectionCard>
    </div>
  );
}
