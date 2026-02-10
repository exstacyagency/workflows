import Anthropic from "@anthropic-ai/sdk";
import { ResearchSource } from "@prisma/client";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export interface ProductIntel {
  main_benefit?: string;
  key_features?: string[];
  usage?: string;
  price?: string;
  format?: string;
  specific_claims?: string[];
  guarantees?: string[];
  variations?: string[];
  shipping?: string;
  citations?: Partial<Record<ProductIntelField, Citation[]>>;
  resolved_via_web_search?: ProductIntelField[];
  validated_fields?: Partial<Record<ProductIntelField, ValidatedField>>;
  [key: string]: unknown;
}

type ProductIntelField =
  | "main_benefit"
  | "key_features"
  | "usage"
  | "price"
  | "format"
  | "specific_claims"
  | "guarantees"
  | "variations"
  | "shipping";

type Citation = {
  source_url: string;
  title?: string;
  quote?: string;
  verification_date?: string;
};

type ValidatedField = {
  status: "verified" | "corrected" | "contradicted" | "unverifiable";
  note?: string;
};

type WebSearchEnrichment = {
  resolved_fields?: Partial<Record<ProductIntelField, unknown>>;
  validated_fields?: Partial<Record<ProductIntelField, ValidatedField>>;
  citations?: Partial<Record<ProductIntelField, Citation[]>>;
};

const PRODUCT_INTEL_FIELDS: ProductIntelField[] = [
  "main_benefit",
  "key_features",
  "usage",
  "price",
  "format",
  "specific_claims",
  "guarantees",
  "variations",
  "shipping",
];

const PRODUCT_INTEL_ARRAY_FIELDS = new Set<ProductIntelField>([
  "key_features",
  "specific_claims",
  "guarantees",
  "variations",
]);

const MAX_HTML_CHARS = 120_000;
const HTML_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = "Mozilla/5.0";
const WEB_SEARCH_TOOL_MAX_STEPS = 5;

function extractJson(text: string): ProductIntel {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("No JSON found in Claude response");
  }

  const rawJson = jsonMatch[0];
  return JSON.parse(rawJson) as ProductIntel;
}

function extractObjectJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in Claude response");
  }
  return JSON.parse(jsonMatch[0]) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()
    )
    .filter(Boolean);
}

function hasValue(value: unknown, field: ProductIntelField): boolean {
  if (PRODUCT_INTEL_ARRAY_FIELDS.has(field)) {
    return normalizeStringArray(value).length > 0;
  }
  return isNonEmptyString(value);
}

function getMissingFields(intel: ProductIntel): ProductIntelField[] {
  return PRODUCT_INTEL_FIELDS.filter((field) => !hasValue(intel[field], field));
}

function normalizeCitationArray(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const sourceUrl = String((entry as { source_url?: unknown }).source_url ?? "").trim();
      if (!sourceUrl) return null;
      const title = String((entry as { title?: unknown }).title ?? "").trim();
      const quote = String((entry as { quote?: unknown }).quote ?? "").trim();
      const verificationDate = String(
        (entry as { verification_date?: unknown }).verification_date ?? ""
      ).trim();
      return {
        source_url: sourceUrl,
        ...(title ? { title } : {}),
        ...(quote ? { quote } : {}),
        ...(verificationDate ? { verification_date: verificationDate } : {}),
      } satisfies Citation;
    })
    .filter((entry): entry is Citation => Boolean(entry));
}

function normalizeValidatedFields(
  value: unknown
): Partial<Record<ProductIntelField, ValidatedField>> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const output: Partial<Record<ProductIntelField, ValidatedField>> = {};

  for (const field of PRODUCT_INTEL_FIELDS) {
    const raw = input[field];
    if (!raw || typeof raw !== "object") continue;

    const statusText = String((raw as { status?: unknown }).status ?? "").trim();
    if (
      statusText !== "verified" &&
      statusText !== "corrected" &&
      statusText !== "contradicted" &&
      statusText !== "unverifiable"
    ) {
      continue;
    }

    const note = String((raw as { note?: unknown }).note ?? "").trim();
    output[field] = {
      status: statusText as ValidatedField["status"],
      ...(note ? { note } : {}),
    };
  }

  return output;
}

function mergeSearchEnrichment(
  baseIntel: ProductIntel,
  enrichment: WebSearchEnrichment
): ProductIntel {
  const merged: ProductIntel = { ...baseIntel };
  const resolvedViaWebSearch: ProductIntelField[] = [];
  const citations: Partial<Record<ProductIntelField, Citation[]>> = {
    ...(baseIntel.citations ?? {}),
  };

  const resolvedFields = enrichment.resolved_fields ?? {};
  const enrichmentCitations = enrichment.citations ?? {};
  const validatedFields = normalizeValidatedFields(enrichment.validated_fields);

  for (const field of PRODUCT_INTEL_FIELDS) {
    const hasBaseValue = hasValue(baseIntel[field], field);
    const hasResolvedValue = hasValue(resolvedFields[field], field);
    const resolutionStatus = validatedFields[field]?.status;
    const shouldOverride = resolutionStatus === "corrected";
    const shouldApply = hasResolvedValue && (!hasBaseValue || shouldOverride);

    if (!shouldApply) {
      continue;
    }

    const fieldCitations = normalizeCitationArray(enrichmentCitations[field]);
    if (fieldCitations.length === 0) {
      console.warn(
        "[Product Intel] Web search value discarded due to missing citations:",
        field
      );
      continue;
    }

    if (PRODUCT_INTEL_ARRAY_FIELDS.has(field)) {
      (merged as Record<string, unknown>)[field] = normalizeStringArray(resolvedFields[field]);
    } else {
      (merged as Record<string, unknown>)[field] = String(resolvedFields[field]).trim();
    }

    citations[field] = fieldCitations;
    resolvedViaWebSearch.push(field);
  }

  if (resolvedViaWebSearch.length > 0) {
    merged.citations = citations;
    merged.resolved_via_web_search = resolvedViaWebSearch;
  }

  if (Object.keys(validatedFields).length > 0) {
    merged.validated_fields = validatedFields;
  }

  return merged;
}

async function runWebSearchEnrichment(
  anthropic: Anthropic,
  args: {
    productUrl: string;
    sourceUrls: string[];
    baseIntel: ProductIntel;
    missingFields: ProductIntelField[];
  }
): Promise<WebSearchEnrichment | null> {
  const { productUrl, sourceUrls, baseIntel, missingFields } = args;
  if (missingFields.length === 0) return null;

  const validationPrompt = `Fix bad extraction and fill gaps.

Product URL: ${productUrl}
Sources: ${sourceUrls.map((url) => `- ${url}`).join("\n")}

Extracted data:
${JSON.stringify(baseIntel, null, 2)}

Missing fields: ${missingFields.join(", ")}

YOUR JOB:
1. Find missing fields via web_search
2. REPLACE vague extracted fields with specific data
3. Verify numbers are real

Return JSON:
{
  "resolved_fields": {
    "field_name": "corrected or new value"
  },
  "validated_fields": {
    "field_name": {
      "status": "verified" | "corrected" | "contradicted" | "unverifiable",
      "note": "what you changed or why it failed"
    }
  },
  "citations": {
    "field_name": [{"source_url": "url", "quote": "exact quote"}]
  }
}

OVERRIDE EXTRACTED DATA IF:
- format is vague ("supplement bottle" → find "90 capsules, 3 daily")
- key_features are benefits not specs ("anti-aging" → find "retinol 2.5%, vitamin C 15%")
- usage lacks numbers ("as directed" → find "2 capsules daily with food")
- specific_claims lack percentages ("effective" → find "73% improvement in 8 weeks")

Put corrected values in resolved_fields. Mark status as "corrected" in validated_fields.

SEARCH AGGRESSIVELY:
- Try 3 variations before giving up:
- For studies: "[brand] study", "[product] clinical trial", "[ingredient] research [condition]"
- For specs: "[product] ingredients list", "[product] dosage", "[product] how to use"

REJECT:
- "#1" or "best-selling" without third-party ranking (Nielsen, Amazon category + date)
- "X,000 reviews" without verification link
- "Clinically proven" without study name

Status definitions:
- verified = data is correct as extracted
- corrected = data was vague, you fixed it with specifics
- contradicted = data is wrong, you found opposing evidence
- unverifiable = tried 3 searches, found nothing

Fix the garbage. Don't validate it.`;

  const validationSystem = "You're a fact-checker with override authority. Use web_search. Return only valid JSON.";

  const tools = [{ type: "web_search_20250305", name: "web_search" }] as const;
  const messages: any[] = [{ role: "user", content: validationPrompt }];
  let finalText = "";

  for (let step = 0; step < WEB_SEARCH_TOOL_MAX_STEPS; step++) {
    const response: any = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2400,
      system: validationSystem,
      messages,
      tools,
    } as any);

    const textBlocks = Array.isArray(response?.content)
      ? response.content.filter((block: any) => block?.type === "text")
      : [];
    finalText =
      textBlocks.map((block: any) => String(block.text ?? "")).join("\n").trim() ||
      finalText;

    if (response?.stop_reason !== "tool_use") {
      if (!finalText) {
        throw new Error("Web search enrichment response missing text content");
      }
      return extractObjectJson<WebSearchEnrichment>(finalText);
    }

    const toolUses = (response.content ?? []).filter(
      (block: any) => block?.type === "tool_use" || block?.type === "server_tool_use"
    );

    if (toolUses.length === 0) {
      throw new Error("Web search reported tool_use but no tool blocks were returned");
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: toolUses.map((toolUse: any) => ({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: "proceed",
      })),
    });
  }

  throw new Error("Web search enrichment exceeded max tool loop steps");
}

async function fetchHtmlWithHttp(productUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(productUrl, {
      method: "GET",
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP fetch failed with status ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectProductIntelWithWebFetch(
  productUrl: string,
  projectId: string,
  jobId: string,
  returnsUrl?: string | null,
  shippingUrl?: string | null,
  aboutUrl?: string | null
): Promise<ProductIntel> {
  console.log("[Product Intel] Starting collection for URL:", productUrl);
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const anthropic = new Anthropic({ apiKey });

  const urls = [productUrl, returnsUrl, shippingUrl, aboutUrl]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const htmlContents = await Promise.all(
    urls.map(async (url) => {
      try {
        const html = await fetchHtmlWithHttp(url);
        return { url, html };
      } catch (error) {
        console.warn("[Product Intel] Failed to fetch URL:", url, error);
        return null;
      }
    })
  );

  const validContents = htmlContents.filter(
    (entry): entry is { url: string; html: string } => Boolean(entry?.html)
  );

  if (validContents.length === 0) {
    throw new Error("Failed to fetch any URLs");
  }

  console.log(
    "[Product Intel] Fetched pages:",
    validContents.map((entry) => ({ url: entry.url, length: entry.html.length }))
  );

  const combinedHtml = validContents
    .map((entry) => `URL: ${entry.url}\n${entry.html.slice(0, MAX_HTML_CHARS)}`)
    .join("\n---\n");

  const extractionPrompt = `Extract product data from these pages:
${combinedHtml}

Return JSON. Pull FACTS, not marketing copy:

{
  "main_benefit": "the ONE problem this solves",
  "key_features": ["specific ingredients/specs/capabilities with amounts - NOT benefits"],
  "usage": "exact dosage/frequency/method - numbers required",
  "price": "number with currency",
  "format": "physical form + exact count + daily amount (e.g., '60 capsules, 2 daily' or '1.7oz bottle, apply twice daily')",
  "specific_claims": ["claims with hard numbers - % improved, days to results, study sample sizes"],
  "guarantees": ["exact terms - number of days, conditions"],
  "variations": ["variant name - count/size - price"],
  "shipping": "shipping policy or threshold",
  "citations": {"field": [{"source_url": "url", "quote": "exact text"}]}
}

RULES:
- key_features = ingredient names + dosages OR tech specs + numbers, NOT "powerful" or "advanced"
- usage = "take X capsules Y times daily" OR "apply X amount Y times daily", NOT "as directed"
- format = count + frequency, NOT product type ("90 capsules, 3 daily" NOT "supplement bottle")
- specific_claims = percentages, timeframes, sample sizes ("75% saw improvement in 30 days"), NOT "effective" or "proven"

If you see marketing fluff, dig for the spec underneath it. Numbers over words. Always.`;

  const extractionSystem = "Return ONLY valid JSON. No markdown.";

  const extraction = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: extractionSystem,
    messages: [
      {
        role: "user",
        content: extractionPrompt,
      },
    ],
  });

  const text = extraction.content.find((c) => c.type === "text")?.text || "{}";
  const baseProductIntel = extractJson(text);
  const missingFields = getMissingFields(baseProductIntel);

  let productIntel = baseProductIntel;
  if (missingFields.length > 0) {
    console.log("[Product Intel] Missing fields after HTML extraction:", missingFields);
    try {
      const enrichment = await runWebSearchEnrichment(anthropic, {
        productUrl,
        sourceUrls: validContents.map((entry) => entry.url),
        baseIntel: baseProductIntel,
        missingFields,
      });
      if (enrichment) {
        productIntel = mergeSearchEnrichment(baseProductIntel, enrichment);
      }
    } catch (error) {
      console.warn("[Product Intel] Web search enrichment failed:", error);
    }
  }
  console.log("[Product Intel] Parsed model response for URL:", productUrl);

  await prisma.researchRow.create({
    data: {
      projectId,
      jobId,
      source: ResearchSource.UPLOADED,
      type: "product_intel",
      content: JSON.stringify(productIntel),
      metadata: {
        url: productUrl,
        returnsUrl: returnsUrl || null,
        shippingUrl: shippingUrl || null,
        aboutUrl: aboutUrl || null,
        webSearchResolvedFields: productIntel.resolved_via_web_search ?? [],
        webSearchCitations: productIntel.citations ?? {},
        webSearchValidatedFields: productIntel.validated_fields ?? {},
        sourceUrls: validContents.map((entry) => entry.url),
        collectedAt: new Date().toISOString(),
        source_url: productUrl,
      },
    },
  });

  return productIntel;
}
