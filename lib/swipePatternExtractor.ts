import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";

type SwipeBeat = {
  beat: string;
  duration: string;
  pattern: string;
};

export type SwipePatterns = {
  hookPattern: string;
  problemPattern: string;
  solutionPattern: string;
  ctaPattern: string;
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
    hookPattern: asString(payload.hookPattern) || "{hook}",
    problemPattern: asString(payload.problemPattern) || "{problem}",
    solutionPattern: asString(payload.solutionPattern) || "{solution}",
    ctaPattern: asString(payload.ctaPattern) || "{cta}",
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
        content: `Extract script patterns from this ${videoDuration}s UGC ad transcript.

Transcript:
${transcript}

Return JSON:
{
  "hookPattern": "Template with {variables}",
  "problemPattern": "Template with {variables}",
  "solutionPattern": "Template with {variables}",
  "ctaPattern": "Template with {variables}",
  "beatStructure": [
    {"beat": "Hook", "duration": "0-3s", "pattern": "{template}"},
    {"beat": "Problem", "duration": "3-8s", "pattern": "{template}"}
  ]
}

Extract STRUCTURE not content. Use {pain}, {product}, {result} as variables.`,
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
