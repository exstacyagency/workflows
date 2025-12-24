export type FetchTimeoutOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
};

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: FetchTimeoutOptions
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const combinedSignal = opts.signal;
  if (combinedSignal?.aborted) controller.abort();
  const onAbort = () => controller.abort();
  combinedSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new FetchTimeoutError(`Fetch timed out after ${opts.timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    combinedSignal?.removeEventListener("abort", onAbort);
  }
}
