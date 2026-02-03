import { cfg } from "@/lib/config";
import { getBreaker } from "@/lib/circuitBreaker";

const APIFY_BASE = "https://api.apify.com/v2";
const FETCH_RETRY_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit | undefined, label: string) {
  const breaker = getBreaker(label);

  return breaker.execute(async () => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${label} failed (${res.status}): ${body}`);
        }
        return res;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === FETCH_RETRY_ATTEMPTS) break;

        const backoff = Math.min(1000 * 2 ** (attempt - 1), 5000);
        await sleep(backoff);
      }
    }

    throw lastError ?? new Error(`${label} failed`);
  }, label);
}

export const apifyClient = {
  actor: (actorId: string) => ({
    call: async ({ input }: { input: any }) => {
      const token = cfg.raw("APIFY_API_TOKEN");
      if (!token) throw new Error("APIFY_API_TOKEN not set");

      const runResponse = await fetchWithRetry(
        `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=120`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        `apify-${actorId}`
      );

      const runData = await runResponse.json();
      return runData?.data ?? runData;
    },
  }),
};
