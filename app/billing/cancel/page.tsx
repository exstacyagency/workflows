import { assertRuntimeModeAllowed } from "@/lib/runtimeMode";

assertRuntimeModeAllowed();

import { notFound } from "next/navigation";
import { isSelfHosted } from "@/lib/config/mode";

export default function BillingCancelPage() {
  if (isSelfHosted()) {
    notFound();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-black/30 p-6">
        <h1 className="text-2xl font-semibold">Checkout canceled</h1>
        <p className="mt-2 text-sm text-white/70">
          No worries — you weren’t charged. You can try again anytime.
        </p>

        <div className="mt-6 flex gap-3">
          <a
            href="/studio"
            className="inline-flex items-center justify-center rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          >
            Back to Studio
          </a>
          <a
            href="/billing"
            className="inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-medium"
          >
            Billing
          </a>
        </div>
      </div>
    </div>
  );
}
