import { assertRuntimeModeAllowed } from "@/lib/runtimeMode";

assertRuntimeModeAllowed();

import { notFound } from "next/navigation";
import { isSelfHosted } from "@/lib/config/mode";
import { SectionCard } from "@/components/ui";

export default function BillingCancelPage() {
  if (isSelfHosted()) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 transition-all duration-500">
      <SectionCard padding="lg" className="max-w-lg w-full space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Checkout canceled</h1>
        <p className="text-base text-muted leading-relaxed">
          No worries — you weren’t charged. You can try again anytime.
        </p>

        <div className="flex gap-3">
          <a
            href="/studio"
            className="btn btn-primary flex-1"
          >
            Back to Studio
          </a>
          <a
            href="/billing"
            className="btn btn-secondary flex-1"
          >
            Billing
          </a>
        </div>
      </SectionCard>
    </div>
  );
}
