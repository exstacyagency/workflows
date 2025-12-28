import { notFound } from "next/navigation";
import { isSelfHosted } from "@/lib/config/mode";

export default function BillingSuccessPage() {
  if (isSelfHosted()) {
    notFound();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-black/30 p-6">
        <h1 className="text-2xl font-semibold">Payment successful</h1>
        <p className="mt-2 text-sm text-white/70">
          Your subscription is now active. You can return to the studio.
        </p>

        <div className="mt-6 flex gap-3">
          <a
            href="/studio"
            className="inline-flex items-center justify-center rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          >
            Go to Studio
          </a>
          <a
            href="/projects"
            className="inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-medium"
          >
            View Projects
          </a>
        </div>

        <p className="mt-4 text-xs text-white/50">
          Note: it can take a few seconds for billing status to update.
        </p>
      </div>
    </div>
  );
}
