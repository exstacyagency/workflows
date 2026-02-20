import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import prisma from "@/lib/prisma";

const IMAGE_PROMPT_MODEL = cfg.raw("ANTHROPIC_HAIKU_MODEL") || "claude-haiku-4-5-20251001";
const IMAGE_PROMPT_SYSTEM_PROMPT =
  "Write static image prompts for AI generators. Two prompts per scene: first frame and last frame. No motion. Pure composition. Under 150 chars each. Output JSON with firstFramePrompt and lastFramePrompt fields.";
const HAS_ANTHROPIC_API_KEY = Boolean(cfg.raw("ANTHROPIC_API_KEY"));

console.log("[imagePromptGeneration] ANTHROPIC_API_KEY present:", HAS_ANTHROPIC_API_KEY);

type PromptPair = {
  firstFramePrompt: string;
  lastFramePrompt: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizePrompt(value: unknown): string {
  const prompt = asString(value).replace(/\s+/g, " ");
  if (prompt.length <= 150) return prompt;
  return prompt.slice(0, 150).trimEnd();
}

function extractTextContent(response: any): string {
  if (!Array.isArray(response?.content)) return "";
  return response.content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block?.text ?? ""))
    .join("\n")
    .trim();
}

function parsePromptPair(text: string): PromptPair | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  const rawJson = jsonMatch?.[0] ?? candidate;

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const firstFramePrompt = normalizePrompt(parsed.firstFramePrompt);
    const lastFramePrompt = normalizePrompt(parsed.lastFramePrompt);
    if (!firstFramePrompt || !lastFramePrompt) return null;
    return { firstFramePrompt, lastFramePrompt };
  } catch {
    return null;
  }
}

function buildFallbackPromptPair(args: {
  characterAction: string;
  environment: string;
  cameraDirection: string;
}): PromptPair {
  const characterAction = args.characterAction || "Creator portrait";
  const environment = args.environment || "studio setting";
  const cameraDirection = args.cameraDirection || "eye-level medium close-up";

  return {
    firstFramePrompt: normalizePrompt(
      `${characterAction}, ${environment}, ${cameraDirection}, balanced light, product visible`,
    ),
    lastFramePrompt: normalizePrompt(
      `${characterAction}, ${environment}, ${cameraDirection}, tighter framing, crisp product focus`,
    ),
  };
}

function buildUserPrompt(args: {
  sceneNumber: number;
  characterAction: string;
  environment: string;
  cameraDirection: string;
}) {
  return `Scene ${args.sceneNumber}
characterAction: ${args.characterAction || "N/A"}
environment: ${args.environment || "N/A"}
cameraDirection: ${args.cameraDirection || "N/A"}

Return strict JSON:
{"firstFramePrompt":"...","lastFramePrompt":"..."}`;
}

async function generatePromptPairForScene(args: {
  anthropic: Anthropic;
  sceneNumber: number;
  characterAction: string;
  environment: string;
  cameraDirection: string;
}): Promise<PromptPair> {
  const fallback = buildFallbackPromptPair(args);

  try {
    const response = await args.anthropic.messages.create({
      model: IMAGE_PROMPT_MODEL,
      max_tokens: 240,
      system: IMAGE_PROMPT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(args),
        },
      ],
    });
    console.log("[imagePromptGeneration] Claude raw response", {
      sceneNumber: args.sceneNumber,
      rawResponse: response,
    });
    const text = extractTextContent(response);
    const parsed = parsePromptPair(text);
    if (!parsed) {
      console.warn("[imagePromptGeneration] Unable to parse Claude JSON response, using fallback", {
        sceneNumber: args.sceneNumber,
        responseText: text,
      });
    }
    return parsed ?? fallback;
  } catch (error: any) {
    console.error("[imagePromptGeneration] Claude Haiku call failed", {
      sceneNumber: args.sceneNumber,
      error: String(error?.message ?? error),
      stack: error?.stack ?? null,
    });
    return fallback;
  }
}

export async function generateImagePromptsFromStoryboard(args: { storyboardId: string; jobId?: string }) {
  console.log("[imagePromptGeneration] generateImagePromptsFromStoryboard entry", {
    storyboardId: args.storyboardId,
    jobId: args.jobId ?? null,
  });

  try {
    const storyboard = await prisma.storyboard.findUnique({
      where: { id: args.storyboardId },
      select: {
        id: true,
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: {
            id: true,
            sceneNumber: true,
            rawJson: true,
          },
        },
      },
    });

    console.log("[imagePromptGeneration] storyboard load complete", {
      storyboardId: args.storyboardId,
      found: Boolean(storyboard),
      sceneCount: storyboard?.scenes?.length ?? 0,
    });

    if (!storyboard) {
      throw new Error("Storyboard not found");
    }
    if (!storyboard.scenes.length) {
      throw new Error("Storyboard has no scenes");
    }

    const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 60_000,
    });

    const prompts: Array<{ sceneNumber: number; firstFramePrompt: string; lastFramePrompt: string }> = [];

    for (const scene of storyboard.scenes) {
      const raw = asObject(scene.rawJson) ?? {};
      const characterAction = asString(raw.characterAction);
      const environment = asString(raw.environment);
      const cameraDirection = asString(raw.cameraDirection);

      console.log("[imagePromptGeneration] before Claude call", {
        storyboardId: storyboard.id,
        sceneId: scene.id,
        sceneNumber: scene.sceneNumber,
        input: {
          characterAction,
          environment,
          cameraDirection,
        },
      });

      const pair = await generatePromptPairForScene({
        anthropic,
        sceneNumber: scene.sceneNumber,
        characterAction,
        environment,
        cameraDirection,
      });

      console.log("[imagePromptGeneration] before scene write", {
        storyboardId: storyboard.id,
        sceneId: scene.id,
        sceneNumber: scene.sceneNumber,
        promptPair: pair,
      });

      await prisma.storyboardScene.update({
        where: { id: scene.id },
        data: {
          rawJson: {
            ...raw,
            firstFramePrompt: pair.firstFramePrompt,
            lastFramePrompt: pair.lastFramePrompt,
          } as any,
        },
      });

      console.log("[imagePromptGeneration] scene write complete", {
        storyboardId: storyboard.id,
        sceneId: scene.id,
        sceneNumber: scene.sceneNumber,
      });

      prompts.push({
        sceneNumber: scene.sceneNumber,
        firstFramePrompt: pair.firstFramePrompt,
        lastFramePrompt: pair.lastFramePrompt,
      });
    }

    return {
      ok: true,
      storyboardId: storyboard.id,
      count: prompts.length,
      prompts,
    };
  } catch (error: any) {
    console.error("[imagePromptGeneration] generateImagePromptsFromStoryboard failed", {
      storyboardId: args.storyboardId,
      jobId: args.jobId ?? null,
      error: String(error?.message ?? error),
      stack: error?.stack ?? null,
    });
    throw error;
  }
}
