import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractTextContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    const record = asObject(item);
    if (record.type === "text" && typeof record.text === "string") {
      return record.text.trim();
    }
  }
  return "";
}

async function callAnthropic(system: string, prompt: string): Promise<string> {
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Anthropic is not configured");
  }

  const model = cfg.raw("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status} ${text}`);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Anthropic returned invalid JSON");
  }

  const root = asObject(parsed);
  const generated = extractTextContent(root.content);
  if (!generated) {
    throw new Error("Anthropic response had no text content");
  }
  return generated;
}

export async function generateCreatorAvatar(args: {
  projectId: string;
  productId: string;
  manualDescription?: string | null;
}): Promise<{ videoPrompt: string; source: "manual" | "claude" }> {
  const manual = asString(args.manualDescription);
  if (manual) {
    return { videoPrompt: manual, source: "manual" };
  }

  const [avatar, product, productIntel, productIntelligence] = await Promise.all([
    prisma.customerAvatar.findFirst({
      where: { projectId: args.projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, persona: true, createdAt: true },
    }),
    prisma.product.findFirst({
      where: { id: args.productId, project_id: args.projectId },
      select: {
        id: true,
        name: true,
        product_problem_solved: true,
        creatorReferenceImageUrl: true,
      },
    }),
    prisma.productIntel.findFirst({
      where: { projectId: args.projectId },
      orderBy: { createdAt: "desc" },
      select: {
        productName: true,
        tagline: true,
        keyFeatures: true,
        keyClaims: true,
        targetAudience: true,
        usp: true,
      },
    }),
    prisma.productIntelligence.findFirst({
      where: { projectId: args.projectId },
      orderBy: { updatedAt: "desc" },
      select: { insights: true },
    }),
  ]);

  if (!avatar) {
    throw new Error("No customer avatar found. Run customer analysis first.");
  }
  if (!product) {
    throw new Error("Product not found for character generation.");
  }

  const personaJson = JSON.stringify(avatar.persona ?? {}, null, 2);
  const productInsightsJson = JSON.stringify(productIntelligence?.insights ?? {}, null, 2);
  const features = (productIntel?.keyFeatures ?? []).slice(0, 8).join(", ");
  const claims = (productIntel?.keyClaims ?? []).slice(0, 8).join(", ");

  const system = [
    "You generate one concise creator visual prompt for Sora character seed video generation.",
    "Output must be plain text only. Do not use markdown or labels.",
    "Style: User-generated content (UGC) aesthetic, smartphone camera realism, natural imperfect lighting, everyday setting.",
  ].join(" ");

  const prompt = `
Create a single-shot 10-second UGC seed-video prompt for a creator character.

Product:
- Name: ${product.name}
- Problem solved: ${product.product_problem_solved ?? "N/A"}
- Intel name: ${productIntel?.productName ?? "N/A"}
- Tagline: ${productIntel?.tagline ?? "N/A"}
- USP: ${productIntel?.usp ?? "N/A"}
- Features: ${features || "N/A"}
- Claims: ${claims || "N/A"}
- Target audience: ${productIntel?.targetAudience ?? "N/A"}

Customer avatar JSON:
${personaJson}

Product intelligence JSON:
${productInsightsJson}

Requirements:
- Focus on the creator's post-transformation confidence and authenticity.
- Camera: front-facing phone camera or selfie-stick perspective.
- Lighting: natural window light or warm practical indoor light.
- Setting: real home/office with visible everyday objects.
- Appearance: natural, unpolished, casual clothing, genuine expression.
- Avoid polished studio/commercial look.
- Keep prompt under 140 words.
`.trim();

  const videoPrompt = (await callAnthropic(system, prompt)).replace(/\s+/g, " ").trim();
  if (!videoPrompt) {
    throw new Error("Generated creator visual prompt was empty");
  }

  return { videoPrompt, source: "claude" };
}
