// lib/billing/pricing.ts

// ─── Anthropic ────────────────────────────────────────────────────────────────
// All prices in microdollars per token (USD / 1,000,000 tokens * 1,000,000)
// effectiveFrom: date this price table was verified

export interface AnthropicModelPricing {
  inputMicros: number;
  outputMicros: number;
  cacheWriteMicros: number;       // 5-minute cache write
  cacheWrite1hMicros: number;     // 1-hour cache write
  cacheReadMicros: number;        // cache hit / refresh
  effectiveFrom: string;
}

export const ANTHROPIC_PRICING: Record<string, AnthropicModelPricing> = {
  // Sonnet 4.x family
  "claude-sonnet-4-6":            { inputMicros: 3_000_000, outputMicros: 15_000_000, cacheWriteMicros: 3_750_000, cacheWrite1hMicros: 6_000_000, cacheReadMicros: 300_000,   effectiveFrom: "2025-03-01" },
  "claude-sonnet-4-5":            { inputMicros: 3_000_000, outputMicros: 15_000_000, cacheWriteMicros: 3_750_000, cacheWrite1hMicros: 6_000_000, cacheReadMicros: 300_000,   effectiveFrom: "2025-03-01" },
  "claude-sonnet-4-20250514":     { inputMicros: 3_000_000, outputMicros: 15_000_000, cacheWriteMicros: 3_750_000, cacheWrite1hMicros: 6_000_000, cacheReadMicros: 300_000,   effectiveFrom: "2025-03-01" },

  // Opus 4.x family
  "claude-opus-4-6":              { inputMicros: 5_000_000, outputMicros: 25_000_000, cacheWriteMicros: 6_250_000, cacheWrite1hMicros: 10_000_000, cacheReadMicros: 500_000,  effectiveFrom: "2025-03-01" },
  "claude-opus-4-5":              { inputMicros: 5_000_000, outputMicros: 25_000_000, cacheWriteMicros: 6_250_000, cacheWrite1hMicros: 10_000_000, cacheReadMicros: 500_000,  effectiveFrom: "2025-03-01" },

  // Haiku family
  "claude-haiku-4-5-20251001":    { inputMicros: 1_000_000, outputMicros: 5_000_000,  cacheWriteMicros: 1_250_000, cacheWrite1hMicros: 2_000_000, cacheReadMicros: 100_000,   effectiveFrom: "2025-03-01" },
  "claude-haiku-3-5":             { inputMicros:   800_000, outputMicros:  4_000_000, cacheWriteMicros: 1_000_000, cacheWrite1hMicros: 1_600_000, cacheReadMicros:  80_000,   effectiveFrom: "2025-03-01" },
  "claude-haiku-3":               { inputMicros:   250_000, outputMicros:  1_250_000, cacheWriteMicros:   300_000, cacheWrite1hMicros:   500_000, cacheReadMicros:  30_000,   effectiveFrom: "2025-03-01" },

  // Deprecated — keep for historical job cost lookups
  "claude-opus-4-1":              { inputMicros: 15_000_000, outputMicros: 75_000_000, cacheWriteMicros: 18_750_000, cacheWrite1hMicros: 30_000_000, cacheReadMicros: 1_500_000, effectiveFrom: "2025-03-01" },
  "claude-opus-4":                { inputMicros: 15_000_000, outputMicros: 75_000_000, cacheWriteMicros: 18_750_000, cacheWrite1hMicros: 30_000_000, cacheReadMicros: 1_500_000, effectiveFrom: "2025-03-01" },
  "claude-opus-3":                { inputMicros: 15_000_000, outputMicros: 75_000_000, cacheWriteMicros: 18_750_000, cacheWrite1hMicros: 30_000_000, cacheReadMicros: 1_500_000, effectiveFrom: "2025-03-01" },
  "claude-sonnet-3-7":            { inputMicros: 3_000_000, outputMicros: 15_000_000, cacheWriteMicros: 3_750_000, cacheWrite1hMicros: 6_000_000, cacheReadMicros: 300_000,   effectiveFrom: "2025-03-01" },
};

export function computeAnthropicCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,       // 5-min writes
  cacheWrite1hTokens = 0,     // 1-hour writes
): number {
  const p = ANTHROPIC_PRICING[model];
  if (!p) throw new Error(`No Anthropic pricing entry for model: ${model}`);

  const micros =
    (inputTokens         * p.inputMicros +
     outputTokens        * p.outputMicros +
     cacheReadTokens     * p.cacheReadMicros +
     cacheWriteTokens    * p.cacheWriteMicros +
     cacheWrite1hTokens  * p.cacheWrite1hMicros) / 1_000_000;

  return Math.ceil(micros / 1_000_000 * 100);
}

// ─── KIE (Veo 3.1 via kie.ai) ─────────────────────────────────────────────────
// Billing unit: per video (fixed 8-second clips)
// "Fast" = Veo 3.1 Fast, "Quality" = Veo 3.1 Quality

export const KIE_PRICING = {
  "veo3-fast":    { centsPerVideo: 40,  secondsPerVideo: 8, effectiveFrom: "2025-03-01" },
  "veo3-quality": { centsPerVideo: 200, secondsPerVideo: 8, effectiveFrom: "2025-03-01" },
} as const;

export function computeKieVideoCostCents(
  model: "veo3-fast" | "veo3-quality" | "veo3_fast" | "veo3_quality",
  videoCount = 1,
): number {
  const normalizedModel = model === "veo3_quality" ? "veo3-quality" : model === "veo3_fast" ? "veo3-fast" : model;
  return KIE_PRICING[normalizedModel].centsPerVideo * videoCount;
}

// ─── Fal.ai ───────────────────────────────────────────────────────────────────
// Merge video: $0.00017 per compute second
// Upscale video: per output second, varies by resolution + fps

export const FAL_PRICING = {
  mergeVideo: {
    centsPerComputeSecond: 0.017,  // $0.00017 → cents
    effectiveFrom: "2025-03-01",
  },
  upscaleVideo: {
    // per output second
    up720p:             { centsPerSecond: 1.0,  effectiveFrom: "2025-03-01" },  // $0.01/s
    "720p_to_1080p":    { centsPerSecond: 2.0,  effectiveFrom: "2025-03-01" },  // $0.02/s
    above1080p:         { centsPerSecond: 8.0,  effectiveFrom: "2025-03-01" },  // $0.08/s
    // multiply by 2 for 60fps output
  },
} as const;

export function computeFalMergeVideoCostCents(computeSeconds: number): number {
  return Math.ceil(computeSeconds * FAL_PRICING.mergeVideo.centsPerComputeSecond);
}

export type FalUpscaleTier = "up720p" | "720p_to_1080p" | "above1080p";

export function computeFalUpscaleCostCents(
  outputSeconds: number,
  tier: FalUpscaleTier,
  is60fps = false,
): number {
  const base = FAL_PRICING.upscaleVideo[tier].centsPerSecond;
  const rate = is60fps ? base * 2 : base;
  return Math.ceil(outputSeconds * rate);
}

// ─── AssemblyAI ───────────────────────────────────────────────────────────────
// Billing unit: per second of audio
// Speaker diarization is additive

export const ASSEMBLYAI_PRICING = {
  universal:   { centsPerSecond: 0.025,  effectiveFrom: "2025-03-01" },  // $0.00025/s
  slam1:       { centsPerSecond: 0.045,  effectiveFrom: "2025-03-01" },  // $0.00045/s
  diarization: { centsPerSecond: 0.033,  effectiveFrom: "2025-03-01" },  // $0.00033/s (additive)
  streaming:   { centsPerHour:   15.0,   effectiveFrom: "2025-03-01" },  // $0.15/hr
} as const;

export type AssemblyAIModel = "universal" | "slam1";

export function computeAssemblyAICostCents(
  audioSeconds: number,
  model: AssemblyAIModel = "universal",
  withDiarization = false,
): number {
  const base = ASSEMBLYAI_PRICING[model].centsPerSecond * audioSeconds;
  const diarization = withDiarization ? ASSEMBLYAI_PRICING.diarization.centsPerSecond * audioSeconds : 0;
  return Math.ceil(base + diarization);
}

// ─── Google Vision OCR ────────────────────────────────────────────────────────
// $1.50 per 1,000 requests
// First 1,000 requests/month free — not modeled here, track separately

export const GOOGLE_VISION_PRICING = {
  ocr: { centsPerRequest: 0.15, effectiveFrom: "2025-03-01" },  // $1.50/1000
} as const;

export function computeGoogleVisionCostCents(requestCount = 1): number {
  return Math.ceil(requestCount * GOOGLE_VISION_PRICING.ocr.centsPerRequest);
}

// ─── Apify ────────────────────────────────────────────────────────────────────
// TikTok Creative Center scraper: $0.005 per 10 ads = $0.0005 per ad

export const APIFY_PRICING = {
  tiktokAds: { centsPerAd: 0.05, effectiveFrom: "2025-03-01" },  // $0.005/10 ads
} as const;

export function computeApifyCostCents(adCount: number): number {
  return Math.ceil(adCount * APIFY_PRICING.tiktokAds.centsPerAd);
}

// ─── Amazon Reviews ───────────────────────────────────────────────────────────
// $0.75 per 1,000 reviews

export const AMAZON_PRICING = {
  reviews: { centsPerReview: 0.075, effectiveFrom: "2025-03-01" },  // $0.75/1000
} as const;

export function computeAmazonReviewsCostCents(reviewCount: number): number {
  return Math.ceil(reviewCount * AMAZON_PRICING.reviews.centsPerReview);
}
