import { assertRuntimeModeAllowed } from "@/lib/runtimeMode";
import { EmptyState, PageHeader } from "@/components/ui";

assertRuntimeModeAllowed();

export default function NotFound() {
  return (
    <html>
      <body className="bg-bg text-text">
        <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
          <PageHeader title="Not found" />
          <EmptyState
            title="Page not found"
            description="The page you requested could not be found."
          />
        </div>
      </body>
    </html>
  );
}
