import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

type PanelTypeValue = "ON_CAMERA" | "B_ROLL_ONLY";

type StoryboardPanel = {
  panelType: PanelTypeValue;
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
  characterAction: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  transitionType: string;
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
    environment: environment || null,
    cameraDirection: asString(raw.cameraDirection),
    productPlacement: asString(raw.productPlacement),
    bRollSuggestions: asStringArray(raw.bRollSuggestions),
    transitionType: asString(raw.transitionType),
  };
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

Previous panel context:
${previousPanel ? `${previousPanel.beatLabel}: ${previousPanel.vo}` : "None"}

Next panel context:
${nextPanel ? `${nextPanel.beatLabel}: ${nextPanel.vo}` : "None"}

Output JSON schema:
{
  "panelType": "ON_CAMERA | B_ROLL_ONLY",
  "beatLabel": "string",
  "characterAction": "string | null",
  "environment": "string | null",
  "cameraDirection": "string",
  "productPlacement": "string",
  "bRollSuggestions": ["string"],
  "transitionType": "string"
}

Keep the same voice and continuity with surrounding panels. Return ONLY valid JSON.`;
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
    const panelIndex = Number((body as Record<string, unknown> | null)?.panelIndex);
    if (!Number.isInteger(panelIndex) || panelIndex < 0) {
      return NextResponse.json({ error: "panelIndex must be a non-negative integer" }, { status: 400 });
    }

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        project: { userId },
      },
      select: {
        id: true,
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
      environment:
        regeneratedPanelType === "B_ROLL_ONLY"
          ? asString(parsedObject.environment) || targetPanel.environment || null
          : asString(parsedObject.environment) || targetPanel.environment || null,
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
