import Anthropic from "@anthropic-ai/sdk";
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

const PRODUCT_INTEL_MODEL = cfg.raw("ANTHROPIC_MODEL") ?? "claude-sonnet-4-20250514";
const PRODUCT_INTEL_MAX_TOKENS = Number(cfg.raw("PRODUCT_INTEL_MAX_TOKENS") ?? 4000);

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
  const seen = new Set<string>();
  const list: string[] = [];

  for (const item of value) {
    const normalized = cleanText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(normalized);
  }

  return list;
}

function buildPrompt(url: string): string {
  return `Use web_fetch to get the product page at ${url}, then extract:

Return ONLY valid JSON (no markdown):
{
  "product_name": "",
  "tagline": "",
  "key_features": [],
  "ingredients_or_specs": [],
  "price": "",
  "key_claims": [],
  "target_audience": "",
  "usp": ""
}`;
}

export async function extractProductIntel(url: string): Promise<ExtractedProductIntel> {
  const normalizedUrl = new URL(url).toString();
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: PRODUCT_INTEL_MODEL,
    max_tokens: PRODUCT_INTEL_MAX_TOKENS,
    tools: [{ type: "web_fetch_20250305", name: "web_fetch" } as any],
    messages: [
      {
        role: "user",
        content: buildPrompt(normalizedUrl),
      },
    ],
  });

  const textContent = message.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON in response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  const productName = cleanText(parsed.product_name);
  if (!productName) {
    throw new Error("Extraction failed: product_name was empty");
  }

  return {
    product_name: productName,
    tagline: toNullableString(parsed.tagline),
    key_features: toStringArray(parsed.key_features),
    ingredients_or_specs: toStringArray(parsed.ingredients_or_specs),
    price: toNullableString(parsed.price),
    key_claims: toStringArray(parsed.key_claims),
    target_audience: toNullableString(parsed.target_audience),
    usp: toNullableString(parsed.usp),
  };
}
