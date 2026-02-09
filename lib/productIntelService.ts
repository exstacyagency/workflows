import { cfg } from "@/lib/config";

export type ExtractedProductIntel = {
  product_name: string;
  tagline: string | null;
  key_features: string[];
  ingredients_or_specs: string[];
  price: string | null;
  key_claims: string[];
  target_audience: string | null;
  usp: string | null;
  raw_html?: string;
};

const PRODUCT_HTML_TIMEOUT_MS = Number(cfg.raw("PRODUCT_HTML_TIMEOUT_MS") ?? 45000);
const PRODUCT_HTML_MAX_CHARS = Number(cfg.raw("PRODUCT_HTML_MAX_CHARS") ?? 120000);
const PRODUCT_INTEL_MAX_TOKENS = Number(cfg.raw("PRODUCT_INTEL_MAX_TOKENS") ?? 1200);
const PRODUCT_INTEL_MODEL = cfg.raw("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-20241022";
const PRODUCT_INTEL_CLAUDE_TIMEOUT_MS = Number(cfg.raw("PRODUCT_INTEL_CLAUDE_TIMEOUT_MS") ?? 90000);
const PRODUCT_PAGE_USER_AGENT =
  "Mozilla/5.0 (compatible; AI-Ad-Lab-ProductIntel/1.0; +https://example.com/bot)";
const FETCH_RETRY_ATTEMPTS = Number(cfg.raw("PRODUCT_INTEL_FETCH_RETRY_ATTEMPTS") ?? 3);

const EXTRACTION_PROMPT =
  'Extract product information from this product page HTML. Return ONLY valid JSON (no markdown, no explanation) with these fields: product_name (string), tagline (string or null), key_features (array of strings), ingredients_or_specs (array of strings), price (string or null), key_claims (array of marketing claims), target_audience (string or null), usp (unique selling proposition string or null). Focus on marketing copy and positioning, not just technical specs. If a field cannot be determined, use null or empty array.';

function isAbortError(err: unknown): boolean {
  const asAny = err as any;
  return (
    asAny?.name === "AbortError" ||
    String(asAny?.message ?? "").toLowerCase().includes("aborted")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  label: string,
  fn: (attempt: number) => Promise<Response>,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= FETCH_RETRY_ATTEMPTS) break;
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 5000);
      console.warn(
        `[Product Intel] ${label} attempt ${attempt} failed: ${lastError.message}. Retrying in ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNullableString(value: unknown): string | null {
  const normalized = cleanText(value);
  return normalized.length > 0 ? normalized : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const list: string[] = [];
  for (const item of value) {
    const normalized = cleanText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    list.push(normalized);
  }
  return list;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const codeFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (codeFence?.[1] ?? trimmed).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Claude response did not include a JSON object");
  }
  const jsonText = candidate.slice(first, last + 1);
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude response JSON was not an object");
  }
  return parsed as Record<string, unknown>;
}

async function fetchProductHtml(url: string): Promise<string> {
  const normalizedUrl = new URL(url).toString();
  console.log("[Product Intel] HTML URL:", normalizedUrl);
  console.log("[Product Intel] HTML timeout (ms):", PRODUCT_HTML_TIMEOUT_MS);
  console.log("[Product Intel] HTML retry attempts:", FETCH_RETRY_ATTEMPTS);

  try {
    const res = await fetchWithRetry("HTML fetch", async (attempt) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PRODUCT_HTML_TIMEOUT_MS);
      try {
        console.log(`[Product Intel] HTML fetch attempt ${attempt}/${FETCH_RETRY_ATTEMPTS}`);
        return await fetch(normalizedUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": PRODUCT_PAGE_USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const snippet = body.replace(/\s+/g, " ").slice(0, 280);
      throw new Error(
        `Failed to fetch product page (${res.status})${snippet ? `: ${snippet}` : ""}`,
      );
    }

    const html = await res.text();
    if (!html.trim()) {
      throw new Error("Product page HTML was empty");
    }

    console.log("[Product Intel] HTML fetched, length:", html.length);
    return html.slice(0, Math.max(2000, PRODUCT_HTML_MAX_CHARS));
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Product HTML fetch timed out after ${PRODUCT_HTML_TIMEOUT_MS}ms (url=${normalizedUrl})`,
      );
    }
    throw error;
  }
}

async function extractWithClaude(html: string, url: string): Promise<Record<string, unknown>> {
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const payload = {
    model: PRODUCT_INTEL_MODEL,
    max_tokens: PRODUCT_INTEL_MAX_TOKENS,
    system:
      "You are a strict information extraction engine. Return only valid JSON. No markdown. No explanation.",
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nSource URL: ${url}\n\nHTML:\n${html}`,
      },
    ],
  };

  console.log("[Product Intel] Sending HTML to Claude...");
  console.log("[Product Intel] Claude model:", PRODUCT_INTEL_MODEL);
  console.log("[Product Intel] Claude timeout (ms):", PRODUCT_INTEL_CLAUDE_TIMEOUT_MS);
  console.log("[Product Intel] Claude retry attempts:", FETCH_RETRY_ATTEMPTS);

  let response: Response;
  try {
    response = await fetchWithRetry("Claude extraction", async (attempt) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PRODUCT_INTEL_CLAUDE_TIMEOUT_MS);
      try {
        console.log(`[Product Intel] Claude attempt ${attempt}/${FETCH_RETRY_ATTEMPTS}`);
        return await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Claude extraction timed out after ${PRODUCT_INTEL_CLAUDE_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Claude extraction failed (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const text = String((data as any)?.content?.[0]?.text ?? "").trim();
  if (!text) {
    throw new Error("Claude extraction response was empty");
  }

  return parseJsonObject(text);
}

export async function extractProductIntel(url: string): Promise<ExtractedProductIntel> {
  console.log("[Product Intel] Fetching URL:", url);
  console.log("[Product Intel] Environment:", process.env.NODE_ENV);
  console.log("[Product Intel] Running in:", process.env.VERCEL ? "Vercel" : "Local");

  const normalizedUrl = new URL(url).toString();
  const html = await fetchProductHtml(normalizedUrl);
  const extracted = await extractWithClaude(html, normalizedUrl);

  const productName = cleanText(extracted.product_name);
  if (!productName) {
    throw new Error("Extraction failed: product_name was empty");
  }

  return {
    product_name: productName,
    tagline: toNullableString(extracted.tagline),
    key_features: toStringArray(extracted.key_features),
    ingredients_or_specs: toStringArray(extracted.ingredients_or_specs),
    price: toNullableString(extracted.price),
    key_claims: toStringArray(extracted.key_claims),
    target_audience: toNullableString(extracted.target_audience),
    usp: toNullableString(extracted.usp),
    raw_html: html,
  };
}
