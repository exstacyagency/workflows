import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";

type SwipeBeat = {
  beat: string;
  duration: string;
  pattern: string;
};

export type SwipePatterns = {
  adMechanism: string;
  mechanismDescription: string;
  hookPattern: string;
  closingPattern: string;
  problemPattern: string | null;
  solutionPattern: string | null;
  ctaPattern: string | null;
  beatStructure: SwipeBeat[];
};

const DEFAULT_SWIPE_MODEL = "claude-sonnet-4-20250514";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const candidate = match?.[0] ?? "{}";
  try {
    return asObject(JSON.parse(candidate));
  } catch {
    return {};
  }
}

function normalizePatterns(payload: Record<string, unknown>): SwipePatterns {
  const rawBeatStructure = Array.isArray(payload.beatStructure)
    ? payload.beatStructure
    : [];
  const beatStructure = rawBeatStructure
    .map((entry) => {
      const row = asObject(entry);
      const beat = asString(row.beat) || "Beat";
      const duration = asString(row.duration) || "N/A";
      const pattern = asString(row.pattern) || "{pattern}";
      return { beat, duration, pattern };
    })
    .filter((entry) => entry.pattern.length > 0)
    .slice(0, 8);

  return {
    adMechanism: asString(payload.adMechanism) || "other",
    mechanismDescription: asString(payload.mechanismDescription) || "",
    hookPattern: asString(payload.hookPattern) || "{hook}",
    closingPattern: asString(payload.closingPattern) || "{closing}",
    problemPattern: payload.problemPattern ? asString(payload.problemPattern) : null,
    solutionPattern: payload.solutionPattern ? asString(payload.solutionPattern) : null,
    ctaPattern: payload.ctaPattern ? asString(payload.ctaPattern) : null,
    beatStructure,
  };
}

export async function extractSwipePatterns(
  transcript: string,
  videoDuration: number,
): Promise<SwipePatterns> {
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const client = new Anthropic({ apiKey, timeout: 60_000 });
  const model = cfg.raw("ANTHROPIC_SWIPE_MODEL")?.trim() || DEFAULT_SWIPE_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are analyzing a UGC ad transcript to extract its ACTUAL psychological structure - not a assumed hook/problem/solution formula.

Transcript (${videoDuration}s):
${transcript}

Step 1: Identify the REAL structural mechanism this ad uses. Examples:
- parasocial_intimacy: direct personal address, relationship-building, no explicit problem
- problem_solution: identifies pain, presents fix
- demonstration: show don't tell, product in action
- social_proof: results-led, before/after
- curiosity_gap: withholds information to drive completion

Step 2: Extract the beat structure AS IT ACTUALLY EXISTS in this ad. Do not invent beats that aren't there.

Return JSON:
{
  "adMechanism": "parasocial_intimacy | problem_solution | demonstration | social_proof | curiosity_gap | other",
  "mechanismDescription": "One sentence describing how this ad actually works psychologically",
  "beatStructure": [
    {"beat": "exact beat name from this ad", "duration": "0-5s", "pattern": "template with {variables}"}
  ],
  "hookPattern": "template for the opening move",
  "closingPattern": "template for how it ends",
  "problemPattern": "only if a problem beat exists, otherwise null",
  "solutionPattern": "only if a solution beat exists, otherwise null",
  "ctaPattern": "only if explicit CTA exists, otherwise null"
}

Extract STRUCTURE not content. Use {brand}, {product}, {viewer_name}, {result}, {claim} as variables.
Do not force hook/problem/solution if the ad does not use that structure.`,
      },
    ],
  });

  const textBlocks = Array.isArray(response.content)
    ? response.content.filter((entry) => entry.type === "text")
    : [];
  const text = textBlocks
    .map((entry) => (entry.type === "text" ? entry.text : ""))
    .join("\n")
    .trim();

  const parsed = extractJsonObject(text || "{}");
  return normalizePatterns(parsed);
}
