function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function generateCreatorAvatar(args: {
  projectId: string;
  productId: string;
  manualDescription?: string | null;
  characterName?: string | null;
}): Promise<{ creatorVisualPrompt: string; imagePrompt: string; source: "manual" }> {
  const referenceTemplate = [
    "Full-body character reference image. Plain white or transparent background.",
    "",
    "Requirements:",
    "- Full body shot, head to toe.",
    "- Plain white or transparent background. No environment, no props, no furniture.",
    "- Casual, everyday clothing appropriate to the target audience.",
    "- Natural, relaxed pose. Arms at sides or slight natural gesture.",
    "- Genuine, approachable expression.",
    "- Natural skin tone and features consistent with the customer avatar.",
    "- Negative prompt: no blurry image, no glossy skin, no overexposed highlights, no flat lighting, no plastic skin texture, no symmetrical lighting, no HDR effect, no airbrushed skin.",
    "- Realism: ultra-realistic.",
    "- Natural skin imperfections: pores, subtle texture visible.",
    "- Shot on iPhone, slightly imperfect framing.",
    "- Available light only.",
    "- Detail level: high skin and fabric texture detail.",
    "- Smartphone selfie realism — not commercial, not studio, not fashion photography.",
  ]
    .filter(Boolean)
    .join("\n");

  const manual = asString(args.manualDescription);
  if (!manual) {
    throw new Error("Manual character description is required");
  }
  const manualFirstPrompt = [
    manual,
    "",
    referenceTemplate,
  ].join("\n");
  return {
    // Persisted description used across storyboard/first-frame/video prompt pipelines.
    creatorVisualPrompt: manual,
    // Full generation prompt used only for Nano Banana avatar image generation.
    imagePrompt: manualFirstPrompt,
    source: "manual",
  };
}
