import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

type PanelTypeValue = "ON_CAMERA" | "B_ROLL_ONLY";
type RegenerateTarget = "panel_direction" | "video_prompt";

const VIDEO_PROMPT_SYSTEM_PROMPT = `You are a video director writing production-grade Sora 2 prompts for UGC supplement ads.
Return only the final prompt text.
Write clear cinematic direction with concrete subject action, camera language, lighting, and environment details.
Keep temporal continuity and character consistency across the shot.
Must be UGC conversion-focused (creator-native, handheld, social-feed direct response), not a polished commercial.`;
const VIDEO_PROMPT_MODEL = cfg.raw("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";

type StoryboardPanel = {
  panelType: PanelTypeValue;
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
  characterAction: string | null;
  characterName: string | null;
  characterDescription: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  transitionType: string;
};

const DEFAULT_ENVIRONMENT_DESCRIPTION =
  "Same environment as Scene 1, with consistent room layout, props, and lighting.";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function normalizePanelType(value: unknown): PanelTypeValue {
  return typeof value === "string" && value === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
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

function parseJsonFromModelText(text: string): unknown {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Claude returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const objStart = trimmed.indexOf("{");
  if (objStart < 0) {
    throw new Error("Claude response does not contain JSON.");
  }

  let depth = 0;
  let end = -1;
  for (let idx = objStart; idx < trimmed.length; idx += 1) {
    const char = trimmed[idx];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      end = idx;
      break;
    }
  }
  if (end === -1) {
    throw new Error("Claude response contains invalid JSON.");
  }
  return JSON.parse(trimmed.slice(objStart, end + 1));
}

function normalizePanel(
  rawValue: unknown,
  sceneNumber: number,
): StoryboardPanel {
  const raw = asObject(rawValue) ?? {};
  const panelType = normalizePanelType(raw.panelType);
  const characterAction = asString(raw.characterAction);
  const environment = asString(raw.environment);
  return {
    panelType,
    beatLabel: asString(raw.beatLabel) || `Beat ${sceneNumber}`,
    startTime: asString(raw.startTime),
    endTime: asString(raw.endTime),
    vo: asString(raw.vo),
    characterAction: characterAction || null,
    characterName: asString(raw.characterName) || null,
    characterDescription: asString(raw.characterDescription) || null,
    environment: environment || null,
    cameraDirection: asString(raw.cameraDirection),
    productPlacement: asString(raw.productPlacement),
    bRollSuggestions: asStringArray(raw.bRollSuggestions),
    transitionType: asString(raw.transitionType),
  };
}

function canonicalEnvironmentFromPanels(panels: StoryboardPanel[]): string | null {
  if (!panels.length) return null;
  const sceneOneEnvironment = (panels[0]?.environment ?? "").trim();
  if (sceneOneEnvironment) return sceneOneEnvironment;
  const firstAvailable = panels
    .map((panel) => String(panel.environment ?? "").trim())
    .find(Boolean);
  return firstAvailable || DEFAULT_ENVIRONMENT_DESCRIPTION;
}

function buildPrompt(args: {
  panelIndex: number;
  totalPanels: number;
  targetPanel: StoryboardPanel;
  previousPanel: StoryboardPanel | null;
  nextPanel: StoryboardPanel | null;
}): string {
  const { panelIndex, totalPanels, targetPanel, previousPanel, nextPanel } = args;

  return `Regenerate visual direction for exactly one storyboard panel in a UGC video.

Panel position: ${panelIndex + 1} of ${totalPanels}
Beat: ${targetPanel.beatLabel}
Timing: ${targetPanel.startTime}-${targetPanel.endTime}
VO: ${targetPanel.vo}
Panel Type: ${targetPanel.panelType}
Character Name: ${targetPanel.characterName || "Not provided"}
Character Description: ${targetPanel.characterDescription || "Not provided"}

Previous panel context:
${previousPanel ? `${previousPanel.beatLabel}: ${previousPanel.vo}` : "None"}

Next panel context:
${nextPanel ? `${nextPanel.beatLabel}: ${nextPanel.vo}` : "None"}

Style requirement:
- UGC conversion ad, not commercial.
- Creator-native, phone-shot realism, direct-response clarity.
- No cinematic polish, no brand-commercial staging.

Output JSON schema:
{
  "panelType": "ON_CAMERA | B_ROLL_ONLY",
  "beatLabel": "string",
  "characterAction": "string | null",
  "characterName": "string | null",
  "characterDescription": "string | null",
  "environment": "string | null",
  "cameraDirection": "string",
  "productPlacement": "string",
  "bRollSuggestions": ["string"],
  "transitionType": "string"
}

Keep the same voice and continuity with surrounding panels. Return ONLY valid JSON.`;
}

function normalizeKlingPrompt(text: string): string {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (normalized.length <= 2400) return normalized;
  return normalized.slice(0, 2400).trimEnd();
}

function formatDurationLabel(durationSec: number): string {
  const rounded = Number.isFinite(durationSec) ? Math.round(durationSec * 10) / 10 : 8;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function toDurationSec(raw: Record<string, unknown> | null): number {
  const rawDuration = Number(raw?.durationSec);
  if (Number.isFinite(rawDuration) && rawDuration > 0) return rawDuration;
  return 8;
}

function buildVideoPromptRegenerationPrompt(args: {
  sceneNumber: number;
  durationSec: number;
  panel: StoryboardPanel;
  hasCreatorRef: boolean;
  hasProductRef: boolean;
}): string {
  const { sceneNumber, durationSec, panel, hasCreatorRef, hasProductRef } = args;
  return `You are generating a Sora 2 video prompt for Scene ${sceneNumber} of a UGC supplement ad.

STORYBOARD PANEL:
Scene ${sceneNumber} | ${formatDurationLabel(durationSec)}s | ${panel.panelType}
Scene VO: ${panel.vo || "N/A"}
Character action: ${panel.characterAction || "N/A"}
Environment: ${panel.environment || "N/A"}
Camera: ${panel.cameraDirection || "N/A"}
Product placement: ${panel.productPlacement || "N/A"}
${panel.bRollSuggestions.length > 0 ? `B-roll: ${panel.bRollSuggestions.join("; ")}` : ""}
${hasCreatorRef ? "Subject: use creator reference image." : ""}
${hasProductRef ? "Product: use product reference image." : ""}

Write a Sora 2 prompt using this structure and labels:

[Scene description: subject, environment, atmosphere]

Cinematography:
Camera shot: [framing and angle]
Lighting + palette: [light source, quality, 3-5 color anchors]
Mood: [tone]

Actions:
- [0s: opening beat]
- [Xs: next beat with timing]
- [Final beat]

Output requirements:
- 350-1200 characters
- No preamble or explanation
- Include concrete physical actions and camera movement
- Avoid generic filler phrasing`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { storyboardId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const storyboardId = String(params?.storyboardId ?? "").trim();
    if (!storyboardId) {
      return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const bodyObject = asObject(body) ?? {};
    const panelIndex = Number(bodyObject.panelIndex);
    const requestedProductId = asString(bodyObject.productId);
    if (!Number.isInteger(panelIndex) || panelIndex < 0) {
      return NextResponse.json({ error: "panelIndex must be a non-negative integer" }, { status: 400 });
    }
    const targetRaw = asString(bodyObject.target || bodyObject.mode).toLowerCase();
    const target: RegenerateTarget = targetRaw === "video_prompt" ? "video_prompt" : "panel_direction";

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        project: { userId },
      },
      select: {
        id: true,
        projectId: true,
        script: {
          select: {
            job: {
              select: {
                payload: true,
              },
            },
          },
        },
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: {
            sceneNumber: true,
            // TODO: Restore after panelType migration runs.
            // panelType: true,
            rawJson: true,
          },
        },
      },
    });

    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
    }

    const scriptJobPayload = asObject(storyboard.script?.job?.payload) ?? {};
    const effectiveProductId = requestedProductId || asString(scriptJobPayload.productId);
    let creatorReferenceImageUrl = "";
    let productReferenceImageUrl = "";
    if (effectiveProductId) {
      const productRows = await prisma.$queryRaw<Array<{
        creatorReferenceImageUrl: string | null;
        productReferenceImageUrl: string | null;
      }>>`
        SELECT
          "creator_reference_image_url" AS "creatorReferenceImageUrl",
          "product_reference_image_url" AS "productReferenceImageUrl"
        FROM "product"
        WHERE "id" = ${effectiveProductId}
          AND "project_id" = ${storyboard.projectId}
        LIMIT 1
      `;
      creatorReferenceImageUrl = asString(productRows[0]?.creatorReferenceImageUrl);
      productReferenceImageUrl = asString(productRows[0]?.productReferenceImageUrl);
    }

    const panels = storyboard.scenes.map((scene) =>
      normalizePanel(scene.rawJson, scene.sceneNumber),
    );
    if (panelIndex >= panels.length) {
      return NextResponse.json(
        { error: `panelIndex out of range. Found ${panels.length} panel(s).` },
        { status: 400 },
      );
    }

    const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
    }

    const targetPanel = panels[panelIndex];
    const previousPanel = panelIndex > 0 ? panels[panelIndex - 1] : null;
    const nextPanel = panelIndex < panels.length - 1 ? panels[panelIndex + 1] : null;
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 30_000,
    });

    if (target === "video_prompt") {
      const sceneNumber = storyboard.scenes[panelIndex]?.sceneNumber ?? panelIndex + 1;
      const targetRawJson = asObject(storyboard.scenes[panelIndex]?.rawJson) ?? {};
      const durationSec = toDurationSec(targetRawJson);
      const hasCreatorRef =
        targetPanel.panelType !== "B_ROLL_ONLY" &&
        Boolean(creatorReferenceImageUrl);
      const hasProductRef = Boolean(productReferenceImageUrl);

      const response = await anthropic.messages.create({
        model: VIDEO_PROMPT_MODEL,
        max_tokens: 2400,
        system: VIDEO_PROMPT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildVideoPromptRegenerationPrompt({
              sceneNumber,
              durationSec,
              panel: targetPanel,
              hasCreatorRef,
              hasProductRef,
            }),
          },
        ],
      });

      const promptText = extractTextContent(response);
      if (!promptText) {
        throw new Error("Claude returned an empty video prompt.");
      }

      return NextResponse.json(
        {
          success: true,
          panelIndex,
          videoPrompt: normalizeKlingPrompt(promptText),
        },
        { status: 200 },
      );
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:
        "You are a UGC video director. Write practical visual direction for a creator filming on a phone. Avoid ad-agency language.",
      messages: [
        {
          role: "user",
          content: buildPrompt({
            panelIndex,
            totalPanels: panels.length,
            targetPanel,
            previousPanel,
            nextPanel,
          }),
        },
      ],
    });

    const responseText = extractTextContent(response);
    const parsed = parseJsonFromModelText(responseText);
    const parsedObject = asObject(parsed) ?? {};

    const regeneratedPanelType = normalizePanelType(parsedObject.panelType ?? targetPanel.panelType);
    const canonicalEnvironment = canonicalEnvironmentFromPanels(panels);
    const regeneratedPanel: StoryboardPanel = {
      panelType: regeneratedPanelType,
      beatLabel: asString(parsedObject.beatLabel) || targetPanel.beatLabel,
      startTime: targetPanel.startTime,
      endTime: targetPanel.endTime,
      vo: targetPanel.vo,
      characterAction:
        regeneratedPanelType === "B_ROLL_ONLY"
          ? asString(parsedObject.characterAction) || targetPanel.characterAction || null
          : asString(parsedObject.characterAction) || targetPanel.characterAction || "",
      characterName: asString(parsedObject.characterName) || targetPanel.characterName || null,
      characterDescription:
        asString(parsedObject.characterDescription) || targetPanel.characterDescription || null,
      environment: canonicalEnvironment,
      cameraDirection: asString(parsedObject.cameraDirection) || targetPanel.cameraDirection,
      productPlacement: asString(parsedObject.productPlacement) || targetPanel.productPlacement,
      bRollSuggestions: asStringArray(parsedObject.bRollSuggestions),
      transitionType: asString(parsedObject.transitionType) || targetPanel.transitionType,
    };

    return NextResponse.json(
      {
        success: true,
        panelIndex,
        panel: regeneratedPanel,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to regenerate panel" },
      { status: 500 },
    );
  }
}
