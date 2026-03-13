import { assertRuntimeMode } from "@/lib/jobRuntimeMode";

export type QuotaResult = {
  ok: boolean;
  error?: Error;
};

export function enforceQuota(result: QuotaResult): void {
  const mode = assertRuntimeMode();

  if (result.ok) return;

  if (mode === "alpha") {
    console.warn("[quota] ignored in alpha:", result.error?.message);
    return;
  }

  throw result.error ?? new Error("Quota enforcement failed");
}
