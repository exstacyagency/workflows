"use client";

import { PageHeader, SectionCard } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="bg-bg text-text">
        <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
          <PageHeader title="Something went wrong" />
          <SectionCard className="space-y-4">
            <pre className="text-body-sm font-mono text-danger whitespace-pre-wrap break-words">
              {error.message}
            </pre>
            <div>
              <button onClick={reset} className="btn btn-secondary !min-h-[32px] px-4 text-label">
                Retry
              </button>
            </div>
          </SectionCard>
        </div>
      </body>
    </html>
  );
}
