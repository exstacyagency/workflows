"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, SectionCard, StatusChip } from "@/components/ui";

type BillingStatus = {
  planId: "FREE" | "GROWTH" | "SCALE";
  status: string | null;
};

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadBilling() {
      try {
        const response = await fetch("/api/billing/status", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" && data.error.trim()
              ? data.error
              : "Unable to load billing status.",
          );
        }

        if (!mounted) return;
        setBilling(data as BillingStatus);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Unable to load billing status.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadBilling();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleOpenPortal() {
    setOpeningPortal(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data?.url !== "string") {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Unable to open billing portal.",
        );
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing portal.");
    } finally {
      setOpeningPortal(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        backHref="/studio"
        backLabel="Back to Studio"
        title="Billing"
        description="Review your current plan and manage billing details."
      />

      <SectionCard padding="lg" className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="eyebrow !mb-0">Current Plan</p>
            <p className="text-body-sm text-muted">
              {loading
                ? "Loading billing status..."
                : billing
                  ? `${billing.planId} plan`
                  : "Billing status unavailable"}
            </p>
          </div>
          {billing && (
            <StatusChip variant={billing.planId === "FREE" ? "subtle" : "success"}>
              {billing.planId}
            </StatusChip>
          )}
        </div>

        {billing?.status && (
          <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
            Subscription status: {billing.status}
          </p>
        )}

        {error && (
          <p className="text-body-sm font-mono text-danger uppercase tracking-widest">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleOpenPortal()}
            disabled={openingPortal || loading}
            className="btn btn-primary !min-h-[36px] px-6 disabled:opacity-50"
          >
            {openingPortal ? "Opening..." : "Manage Billing"}
          </button>
          <Link href="/projects" className="btn btn-secondary !min-h-[36px] px-6">
            View Projects
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
