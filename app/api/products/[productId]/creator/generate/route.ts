import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import {
  CreatorLibraryRow,
  ensureCreatorLibraryTables,
  findOwnedProductById,
  toCreatorLibraryResponse,
} from "@/lib/creatorLibraryStore";
import { prisma } from "@/lib/prisma";

const GenerateCreatorSchema = z.object({
  creatorDescription: z.string().trim().min(1, "creatorDescription is required").max(2000),
});

const CREATOR_PROMPT_SYSTEM =
  "Write photorealistic headshot prompts. Direct eye contact. Natural expression. Professional lighting. Trustworthy but approachable. 150 chars max.";

function normalizePrompt(text: string): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 150) return normalized;
  return normalized.slice(0, 150).trimEnd();
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
    `${description}. Photorealistic headshot, direct eye contact, natural expression, professional lighting, approachable and trustworthy.`,
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
          content: `Creator description: ${description}\n\nReturn one prompt line under 150 characters.`,
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

function extractImageUrl(payload: any): string {
  const candidates: unknown[] = [
    payload?.imageUrl,
    payload?.image_url,
    payload?.url,
    payload?.data?.imageUrl,
    payload?.data?.image_url,
    payload?.data?.url,
    Array.isArray(payload?.images) ? payload.images[0] : null,
    Array.isArray(payload?.data?.images) ? payload.data.images[0] : null,
    Array.isArray(payload?.output) ? payload.output[0] : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const nested = [record.url, record.imageUrl, record.image_url];
      for (const value of nested) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
  }

  throw new Error(
    "Midjourney response missing image URL. Configure MIDJOURNEY_API_URL to a synchronous endpoint that returns imageUrl.",
  );
}

async function generateCreatorImageWithMidjourney(prompt: string): Promise<string> {
  const apiUrl = cfg.raw("MIDJOURNEY_API_URL");
  const apiKey = cfg.raw("MIDJOURNEY_API_KEY");

  if (!apiUrl || !apiKey) {
    throw new Error("MIDJOURNEY_API_URL and MIDJOURNEY_API_KEY must be set.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Midjourney request failed: ${response.status} ${rawText}`);
  }

  let payload: any = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`Midjourney response was not valid JSON: ${rawText || "<empty>"}`);
  }

  return extractImageUrl(payload);
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
    const imageUrl = await generateCreatorImageWithMidjourney(generatedPrompt);

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
