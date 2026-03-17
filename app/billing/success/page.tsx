import { notFound } from "next/navigation";
import { isSelfHosted } from "@/lib/config/mode";

export default function BillingSuccessPage() {
  if (isSelfHosted()) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 transition-all duration-500">
      <div className="max-w-lg w-full rounded-card border border-line bg-panel p-8 space-y-6 shadow-panel backdrop-blur-panel">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Payment successful</h1>
        <p className="text-[15px] text-muted leading-relaxed">
          Your subscription is now active. You can return to the studio.
        </p>

        <div className="flex gap-3">
          <a
            href="/studio"
            className="btn btn-primary flex-1"
          >
            Go to Studio
          </a>
          <a
            href="/projects"
            className="btn btn-secondary flex-1"
          >
            View Projects
          </a>
        </div>

        <p className="text-[11px] font-mono text-muted/40 uppercase tracking-widest text-center mt-2">
          Note: it can take a few seconds for billing status to update
        </p>
      </div>
    </div>
  );
}
