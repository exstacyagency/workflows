import Anthropic from "@anthropic-ai/sdk";
import { ResearchSource } from "@prisma/client";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { computeAnthropicCostCents } from "@/lib/billing/pricing";

export interface ProductIntel {
  main_benefit?: string;
  mechanismProcess?: string;
  key_features?: string[];
  usage?: string;
  price?: string;
  format?: string;
  specific_claims?: string[];
  variations?: string[];
  shipping?: string;
  citations?: Partial<Record<ProductIntelField, Citation[]>>;
  resolved_via_web_search?: ProductIntelField[];
  validated_fields?: Partial<Record<ProductIntelField, ValidatedField>>;
  reverification_required_fields?: ProductIntelField[];
  [key: string]: unknown;
}

type ProductIntelField =
  | "main_benefit"
  | "mechanismProcess"
  | "key_features"
  | "usage"
  | "price"
  | "format"
  | "specific_claims"
  | "variations"
  | "shipping";

type Citation = {
  source_url: string;
  title?: string;
  quote?: string;
  verification_date?: string;
  source_domain?: string;
  source_confidence?: "high" | "low";
  needs_reverification?: boolean;
  confidence_reason?: string;
};

type ValidatedField = {
  status: "verified" | "corrected" | "contradicted" | "unverifiable";
  note?: string;
};

type BillingUsageEntry = {
  metric: string;
  provider: string;
  model: string;
  units: number;
  costCents: number;
  metadata: {
    inputTokens: number;
    outputTokens: number;
  };
};

const PRODUCT_INTEL_ANTHROPIC_MODEL = "claude-sonnet-4-6";

const PRODUCT_INTEL_FIELDS: ProductIntelField[] = [
  "main_benefit",
  "mechanismProcess",
  "key_features",
  "usage",
  "price",
  "format",
  "specific_claims",
  "variations",
  "shipping",
];

const PRODUCT_INTEL_ARRAY_FIELDS = new Set<ProductIntelField>([
  "key_features",
  "specific_claims",
  "variations",
]);

const MAX_HTML_CHARS = 120_000;
const HTML_FETCH_TIMEOUT_MS = 30_000;
const PRODUCT_INTEL_EXTRACTION_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = "Mozilla/5.0";
const SPECIFIC_CLAIM_NUMERIC_PATTERN = /\d/;
const SPECIFIC_CLAIM_MEASURABLE_UNIT_PATTERN =
  /\b(?:mg|g|kg|mcg|ug|ml|l|oz|lb|lbs|capsule(?:s)?|tablet(?:s)?|serving(?:s)?|day(?:s)?|week(?:s)?|month(?:s)?|year(?:s)?|hour(?:s)?|minute(?:s)?|sec(?:ond)?s?)\b/i;
const LOW_CONFIDENCE_HOST_SIGNALS = [
  "coupon",
  "coupons",
  "deal",
  "deals",
  "discount",
  "promo",
  "voucher",
  "cashback",
  "affiliate",
  "affiliates",
  "shareasale",
  "linksynergy",
  "skimlinks",
  "rakutenadvertising",
  "awin1",
  "impact.com",
  "cj.com",
];
const LOW_CONFIDENCE_QUERY_SIGNALS = [
  "aff_id",
  "affiliate",
  "referrer",
  "utm_affiliate",
  "coupon",
  "deal",
  "promo",
];

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

function claimHasNumericSignal(claim: string): boolean {
  const text = claim.trim();
  if (!text) return false;
  return (
    SPECIFIC_CLAIM_NUMERIC_PATTERN.test(text) ||
    SPECIFIC_CLAIM_MEASURABLE_UNIT_PATTERN.test(text)
  );
}

function specificClaimsAreQuantified(claims: unknown): boolean {
  const normalizedClaims = normalizeStringArray(claims);
  if (normalizedClaims.length === 0) return false;
  return normalizedClaims.some((claim) => claimHasNumericSignal(claim));
}

function hasValue(value: unknown, field: ProductIntelField): boolean {
  if (field === "specific_claims") {
    // Specific claims are only valid when at least one claim has a measurable number/unit.
    return specificClaimsAreQuantified(value);
  }
  if (PRODUCT_INTEL_ARRAY_FIELDS.has(field)) {
    return normalizeStringArray(value).length > 0;
  }
  return isNonEmptyString(value);
}

function getMissingFields(intel: ProductIntel): ProductIntelField[] {
  const missing = new Set<ProductIntelField>(
    PRODUCT_INTEL_FIELDS.filter((field) => !hasValue(intel[field], field))
  );

  const hasAnyCitations = countCitations(intel.citations) > 0;
  const hasSpecificClaimsCitations =
    normalizeCitationArray(intel.citations?.specific_claims).length > 0;

  // Always force specific_claims through web-search validation/enrichment.
  missing.add("specific_claims");

  // Empty citations are never considered complete.
  if (!hasAnyCitations || !hasSpecificClaimsCitations) {
    missing.add("specific_claims");
  }

  return Array.from(missing);
}

function normalizeCitationArray(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): Citation | null => {
      if (!entry || typeof entry !== "object") return null;
      const sourceUrl = String((entry as { source_url?: unknown }).source_url ?? "").trim();
      if (!sourceUrl) return null;
      const title = String((entry as { title?: unknown }).title ?? "").trim();
      const quote = String((entry as { quote?: unknown }).quote ?? "").trim();
      const verificationDate = String(
        (entry as { verification_date?: unknown }).verification_date ?? ""
      ).trim();
      const confidenceAssessment = assessCitationSourceConfidence(sourceUrl);
      return {
        source_url: sourceUrl,
        ...(title ? { title } : {}),
        ...(quote ? { quote } : {}),
        ...(verificationDate ? { verification_date: verificationDate } : {}),
        ...(confidenceAssessment.source_domain
          ? { source_domain: confidenceAssessment.source_domain }
          : {}),
        source_confidence: confidenceAssessment.source_confidence,
        needs_reverification: confidenceAssessment.needs_reverification,
        ...(confidenceAssessment.confidence_reason
          ? { confidence_reason: confidenceAssessment.confidence_reason }
          : {}),
      } satisfies Citation;
    })
    .filter((entry): entry is Citation => Boolean(entry));
}

function countCitations(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  return Object.values(record).reduce<number>((total, fieldCitations) => {
    return total + normalizeCitationArray(fieldCitations).length;
  }, 0);
}

function isTimeoutError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error).toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

function appendAnthropicUsageEntry(
  usageEntries: BillingUsageEntry[],
  response: unknown,
  model = PRODUCT_INTEL_ANTHROPIC_MODEL
) {
  const inputTokens = Number((response as any)?.usage?.input_tokens ?? 0);
  const outputTokens = Number((response as any)?.usage?.output_tokens ?? 0);
  const totalTokens = Math.max(0, Math.trunc(inputTokens + outputTokens));
  if (totalTokens <= 0) return;

  usageEntries.push({
    metric: "tokens",
    provider: "anthropic",
    model,
    units: totalTokens,
    costCents: computeAnthropicCostCents(
      model,
      Math.max(0, Math.trunc(inputTokens)),
      Math.max(0, Math.trunc(outputTokens)),
    ),
    metadata: {
      inputTokens: Math.max(0, Math.trunc(inputTokens)),
      outputTokens: Math.max(0, Math.trunc(outputTokens)),
    },
  });
}

function assessCitationSourceConfidence(sourceUrl: string): {
  source_domain: string | null;
  source_confidence: "high" | "low";
  needs_reverification: boolean;
  confidence_reason?: string;
} {
  let url: URL | null = null;
  try {
    url = new URL(sourceUrl);
  } catch {
    return {
      source_domain: null,
      source_confidence: "high",
      needs_reverification: false,
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const query = url.search.toLowerCase();

  const hostSignal = LOW_CONFIDENCE_HOST_SIGNALS.find((signal) =>
    hostname.includes(signal)
  );
  const querySignal = LOW_CONFIDENCE_QUERY_SIGNALS.find((signal) =>
    query.includes(signal)
  );

  if (hostSignal) {
    return {
      source_domain: hostname,
      source_confidence: "low",
      needs_reverification: true,
      confidence_reason: `Low-confidence source domain matched "${hostSignal}"`,
    };
  }

  if (querySignal) {
    return {
      source_domain: hostname,
      source_confidence: "low",
      needs_reverification: true,
      confidence_reason: `Low-confidence URL parameter matched "${querySignal}"`,
    };
  }

  return {
    source_domain: hostname,
    source_confidence: "high",
    needs_reverification: false,
  };
}

function normalizeProductIntel(intel: ProductIntel): ProductIntel {
  const normalized: ProductIntel = {
    ...intel,
    ...(isNonEmptyString(intel.main_benefit)
      ? { main_benefit: intel.main_benefit.trim() }
      : {}),
    ...(isNonEmptyString(intel.mechanismProcess)
      ? { mechanismProcess: intel.mechanismProcess.trim() }
      : {}),
  };
  delete (normalized as Record<string, unknown>).guarantees;
  const normalizedCitations: Partial<Record<ProductIntelField, Citation[]>> = {};
  const reverificationRequiredFields: ProductIntelField[] = [];

  for (const field of PRODUCT_INTEL_FIELDS) {
    const fieldCitations = normalizeCitationArray(intel.citations?.[field]);
    if (fieldCitations.length === 0) continue;
    normalizedCitations[field] = fieldCitations;
    if (fieldCitations.some((citation) => citation.needs_reverification)) {
      reverificationRequiredFields.push(field);
    }
  }

  // Always persist citations, even when empty.
  normalized.citations = normalizedCitations;

  if (reverificationRequiredFields.length > 0) {
    normalized.reverification_required_fields = Array.from(
      new Set(reverificationRequiredFields)
    );
  } else {
    delete normalized.reverification_required_fields;
  }

  return normalized;
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
): Promise<ProductIntel & { usageEntries: BillingUsageEntry[] }> {
  console.log("[Product Intel] Starting collection for URL:", productUrl);
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const anthropic = new Anthropic({ apiKey, timeout: 60000 });

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
  "mechanismProcess": "how the product works mechanically (inputs/components -> biological/technical action -> user-level effect)",
  "key_features": ["specific ingredients/specs/capabilities with amounts - NOT benefits"],
  "usage": "exact dosage/frequency/method - numbers required",
  "price": "number with currency",
  "format": "physical form + exact count + daily amount (e.g., '60 capsules, 2 daily' or '1.7oz bottle, apply twice daily')",
  "specific_claims": ["claims with hard numbers - % improved, days to results, study sample sizes"],
  "variations": ["variant name - count/size - price"],
  "shipping": "shipping policy or threshold",
  "citations": {"field": [{"source_url": "url", "quote": "exact text"}]}
}

RULES:
- mechanismProcess = concrete mechanism, not marketing outcome. Include technical/biological chain of action.
- key_features = ingredient names + dosages OR tech specs + numbers, NOT "powerful" or "advanced"
- usage = "take X capsules Y times daily" OR "apply X amount Y times daily", NOT "as directed"
- format = count + frequency, NOT product type ("90 capsules, 3 daily" NOT "supplement bottle")
- specific_claims = percentages, timeframes, sample sizes ("75% saw improvement in 30 days"), NOT "effective" or "proven"

If you see marketing fluff, dig for the spec underneath it. Numbers over words. Always.`;

  const extractionSystem = "Return ONLY valid JSON. No markdown.";

  const usageEntries: BillingUsageEntry[] = [];
  let baseProductIntel = normalizeProductIntel({ specific_claims: [] });
  try {
    const extraction = await Promise.race([
      anthropic.messages.create({
        model: PRODUCT_INTEL_ANTHROPIC_MODEL,
        max_tokens: 2000,
        system: extractionSystem,
        messages: [
          {
            role: "user",
            content: extractionPrompt,
          },
        ],
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Product intel extraction timed out after 30 seconds"));
        }, PRODUCT_INTEL_EXTRACTION_TIMEOUT_MS);
      }),
    ]);
    appendAnthropicUsageEntry(usageEntries, extraction);

    const text = extraction.content.find((c) => c.type === "text")?.text || "{}";
    baseProductIntel = normalizeProductIntel(extractJson(text));
  } catch (error) {
    if (isTimeoutError(error)) {
      console.warn(
        "[Product Intel] Extraction timed out; continuing with specific_claims set to an empty array"
      );
    } else {
      throw error;
    }
  }
  const productIntel = baseProductIntel;
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
        webSearchReverificationRequiredFields:
          productIntel.reverification_required_fields ?? [],
        sourceUrls: validContents.map((entry) => entry.url),
        collectedAt: new Date().toISOString(),
        source_url: productUrl,
      },
    },
  });

  return {
    ...productIntel,
    usageEntries,
  };
}
