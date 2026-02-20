import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from "@/lib/imageProviders/kieImage";
import {
  CreatorLibraryRow,
  ensureCreatorLibraryTables,
  findOwnedProductById,
  toCreatorLibraryResponse,
} from "@/lib/creatorLibraryStore";
import { getProvider } from "@/lib/imageProviders/registry";
import { prisma } from "@/lib/prisma";

const GenerateCreatorSchema = z.object({
  creatorDescription: z.string().trim().min(1, "creatorDescription is required").max(2000),
});

const CREATOR_NEUTRAL_STYLE =
  "Professional neutral headshot, straight-on camera angle, even studio lighting, neutral expression, plain background, business casual attire, forward-facing pose";
const CREATOR_PROMPT_SYSTEM =
  `Write a photorealistic creator-reference headshot prompt optimized for Kling consistency. Base style: "${CREATOR_NEUTRAL_STYLE}". Keep output neutral and professional. Avoid emotion words like smile, warm, approachable. Return one prompt line only.`;

function readPositiveIntEnv(name: string, fallback: number, min = 1): number {
  const raw = cfg.raw(name);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= min) {
    return Math.floor(parsed);
  }
  if (raw != null && String(raw).trim() !== "") {
    console.warn(`[creator.generate] Invalid ${name}=${String(raw)}. Using fallback ${fallback}.`);
  }
  return fallback;
}

const KIE_CREATOR_POLL_INTERVAL_MS = readPositiveIntEnv(
  "KIE_CREATOR_POLL_INTERVAL_MS",
  POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
);
const KIE_CREATOR_POLL_MAX_ATTEMPTS = readPositiveIntEnv(
  "KIE_CREATOR_POLL_MAX_ATTEMPTS",
  MAX_POLL_ATTEMPTS,
  MAX_POLL_ATTEMPTS,
);

function normalizePrompt(text: string): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 320) return normalized;
  return normalized.slice(0, 320).trimEnd();
}

function extractTextContent(response: any): string {
  return Array.isArray(response?.content)
    ? response.content
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block?.text ?? ""))
        .join("\n")
        .trim()
    : "";
}

function fallbackPrompt(description: string): string {
  return normalizePrompt(
    `${CREATOR_NEUTRAL_STYLE}. Subject demographics: ${description}.`,
  );
}

async function generateCreatorPrompt(description: string): Promise<string> {
  const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    return fallbackPrompt(description);
  }

  try {
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 60_000,
    });

    const response = await anthropic.messages.create({
      model: cfg.raw("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929",
      max_tokens: 180,
      system: CREATOR_PROMPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Creator description: ${description}\n\nReturn one prompt line using the neutral professional reference-headshot style.`,
        },
      ],
    });

    const text = extractTextContent(response);
    return text ? normalizePrompt(text) : fallbackPrompt(description);
  } catch (error) {
    console.error("[creator.generate] Claude prompt generation failed", {
      error: String((error as any)?.message ?? error),
    });
    return fallbackPrompt(description);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateCreatorImageWithKie(prompt: string, productId: string): Promise<string> {
  const kieApiBaseUrl = cfg.raw("KIE_API_BASE_URL") ?? null;
  const kieCreatePath = cfg.raw("KIE_CREATE_PATH") ?? null;
  const kieStatusPath = cfg.raw("KIE_STATUS_PATH") ?? null;
  const hasKieApiKey = Boolean(cfg.raw("KIE_API_KEY"));

  console.log("[creator.generate] KIE creator generation function start", {
    timestamp: new Date().toISOString(),
    productId,
    prompt,
  });
  console.log("[creator.generate] KIE endpoint/auth configuration", {
    timestamp: new Date().toISOString(),
    kieApiBaseUrl,
    kieCreatePath,
    kieStatusPath,
    hasKieApiKey,
  });
  console.log("[creator.generate] Starting KIE creator image generation", {
    productId,
    pollIntervalMs: KIE_CREATOR_POLL_INTERVAL_MS,
    pollMaxAttempts: KIE_CREATOR_POLL_MAX_ATTEMPTS,
  });
  const provider = getProvider(cfg.raw("VIDEO_IMAGE_PROVIDER_ID"));
  const createPayload = {
    storyboardId: `creator:${productId}`,
    idempotencyKey: JSON.stringify(["CREATOR_FACE_GENERATION", productId, Date.now()]),
    force: true,
    prompts: [{ frameIndex: 0, prompt }],
    options: {
      purpose: "creator_library",
      productId,
    },
  };
  console.log("[creator.generate] KIE createTask request payload", {
    timestamp: new Date().toISOString(),
    productId,
    payload: createPayload,
  });

  let createResult: Awaited<ReturnType<typeof provider.createTask>>;
  try {
    createResult = await provider.createTask(createPayload);
  } catch (error: any) {
    console.log("[creator.generate] KIE createTask failed before taskId extraction", {
      timestamp: new Date().toISOString(),
      productId,
      error,
    });
    throw error;
  }

  console.log("[creator.generate] KIE createTask raw response", {
    timestamp: new Date().toISOString(),
    productId,
    statusCode: createResult.httpStatus ?? null,
    bodyText: createResult.responseText ?? null,
    bodyJson: createResult.raw,
  });
  const hasTaskId = Boolean(createResult.taskId && String(createResult.taskId).trim());
  console.log("[creator.generate] KIE task ID extraction", {
    timestamp: new Date().toISOString(),
    productId,
    hasTaskId,
    taskId: createResult.taskId ?? null,
  });
  if (!hasTaskId) {
    throw new Error("KIE createTask did not return a task ID.");
  }

  let attemptsMade = 0;
  for (let attempt = 0; attempt < KIE_CREATOR_POLL_MAX_ATTEMPTS; attempt += 1) {
    attemptsMade = attempt + 1;
    let task: Awaited<ReturnType<typeof provider.getTask>>;
    try {
      task = await provider.getTask(createResult.taskId);
    } catch (error: any) {
      console.log("[creator.generate] KIE polling attempt failed", {
        timestamp: new Date().toISOString(),
        productId,
        taskId: createResult.taskId,
        attemptNumber: attemptsMade,
        maxAttempts: KIE_CREATOR_POLL_MAX_ATTEMPTS,
        error,
      });
      throw error;
    }
    console.log("[creator.generate] KIE polling attempt result", {
      timestamp: new Date().toISOString(),
      productId,
      taskId: createResult.taskId,
      attemptNumber: attemptsMade,
      maxAttempts: KIE_CREATOR_POLL_MAX_ATTEMPTS,
      statusCode: task.httpStatus ?? null,
      status: task.status,
      bodyText: task.responseText ?? null,
      bodyJson: task.raw,
      errorMessage: task.errorMessage ?? null,
      imageCount: task.images?.length ?? 0,
    });
    if (task.status === "SUCCEEDED") {
      const imageUrl = task.images?.[0]?.url?.trim();
      if (!imageUrl) {
        throw new Error("KIE task succeeded but returned no image URL.");
      }
      return imageUrl;
    }
    if (task.status === "FAILED") {
      throw new Error(task.errorMessage || "KIE image generation task failed.");
    }
    await wait(KIE_CREATOR_POLL_INTERVAL_MS);
  }

  console.log("[creator.generate] KIE creator generation timed out", {
    timestamp: new Date().toISOString(),
    productId,
    taskId: createResult.taskId,
    attemptsMade,
    configuredMaxAttempts: KIE_CREATOR_POLL_MAX_ATTEMPTS,
  });
  throw new Error(
    `KIE image generation timed out after ${attemptsMade} polling attempts.`,
  );
}

export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureCreatorLibraryTables();

    const product = await findOwnedProductById(params.productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const parsed = GenerateCreatorSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const generatedPrompt = await generateCreatorPrompt(parsed.data.creatorDescription);
    const imageUrl = await generateCreatorImageWithKie(generatedPrompt, product.id);

    const libraryId = randomUUID();
    const rows = await prisma.$queryRaw<CreatorLibraryRow[]>`
      INSERT INTO "creator_library" (
        "id",
        "product_id",
        "image_url",
        "prompt",
        "is_active"
      )
      VALUES (
        ${libraryId},
        ${product.id},
        ${imageUrl},
        ${generatedPrompt},
        false
      )
      RETURNING
        "id",
        "product_id" AS "productId",
        "image_url" AS "imageUrl",
        "prompt",
        "is_active" AS "isActive",
        "created_at" AS "createdAt"
    `;

    const created = rows[0];
    if (!created) {
      throw new Error("Failed to store generated creator image.");
    }

    return NextResponse.json(
      {
        success: true,
        imageUrl: created.imageUrl,
        libraryId: created.id,
        entry: toCreatorLibraryResponse(created),
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Failed to generate creator library face", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate creator face" },
      { status: 500 },
    );
  }
}
