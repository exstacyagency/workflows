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

const PRODUCT_INTEL_MODEL = cfg.raw('ANTHROPIC_MODEL') || 'claude-sonnet-4-5-20250929';
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
  return `Fetch the product page at ${url} and extract product information.

Use the web_fetch tool to get the page content, then analyze it and return product details.

Return your response as valid JSON only (no markdown, no explanation):
{
  "product_name": "exact product name",
  "tagline": "main headline or tagline",
  "key_features": ["feature 1", "feature 2", "feature 3"],
  "ingredients_or_specs": ["ingredient 1", "spec 1"],
  "price": "$XX.XX or price range",
  "key_claims": ["marketing claim 1", "claim 2"],
  "target_audience": "who this is for",
  "usp": "unique selling proposition"
}

Focus on marketing copy and positioning, not just technical specs. Extract the actual marketing language used on the page.`;
}

export async function extractProductIntel(url: string): Promise<ExtractedProductIntel> {
  const normalizedUrl = new URL(url).toString();
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const anthropic = new Anthropic({ apiKey, timeout: 60000 });

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

  const textBlocks = message.content.filter((c) => c.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];

  if (!lastText || lastText.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonMatch = lastText.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response. Got: ${lastText.text.substring(0, 200)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch (err) {
    console.error("[Product Intel] Failed to parse JSON:", jsonMatch[0]);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Claude response as JSON: ${message}`);
  }

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
