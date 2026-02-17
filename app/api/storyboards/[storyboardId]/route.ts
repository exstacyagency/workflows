import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  validateStoryboardAgainstGates,
  type StoryboardValidationReport,
} from "@/lib/storyboardValidation";

type StoryboardPanelResponse = {
  panelType: "ON_CAMERA" | "B_ROLL_ONLY";
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

type StoryboardResponseBody = {
  id: string;
  projectId: string;
  scriptId: string | null;
  createdAt: string;
  updatedAt: string;
  panels: StoryboardPanelResponse[];
  validationReport: StoryboardValidationReport;
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

function normalizePanelType(value: unknown): "ON_CAMERA" | "B_ROLL_ONLY" {
  return typeof value === "string" && value === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized || null;
}

function normalizePanelFromRaw(
  rawValue: unknown,
  sceneNumber: number,
): StoryboardPanelResponse {
  const raw = asObject(rawValue) ?? {};
  const panelType = normalizePanelType(raw.panelType);
  return {
    panelType,
    beatLabel: asString(raw.beatLabel) || `Beat ${sceneNumber}`,
    startTime: asString(raw.startTime),
    endTime: asString(raw.endTime),
    vo: asString(raw.vo),
    characterAction: asNullableString(raw.characterAction),
    environment: asNullableString(raw.environment),
    cameraDirection: asString(raw.cameraDirection),
    productPlacement: asString(raw.productPlacement),
    bRollSuggestions: asStringArray(raw.bRollSuggestions),
    transitionType: asString(raw.transitionType),
  };
}

function normalizePanelFromInput(value: unknown, index: number): StoryboardPanelResponse {
  const raw = asObject(value) ?? {};
  const panelType = normalizePanelType(raw.panelType);
  return {
    panelType,
    beatLabel: asString(raw.beatLabel) || `Beat ${index + 1}`,
    startTime: asString(raw.startTime),
    endTime: asString(raw.endTime),
    vo: asString(raw.vo),
    characterAction: panelType === "B_ROLL_ONLY" ? asNullableString(raw.characterAction) : asString(raw.characterAction),
    environment: panelType === "B_ROLL_ONLY" ? asNullableString(raw.environment) : asString(raw.environment),
    cameraDirection: asString(raw.cameraDirection),
    productPlacement: asString(raw.productPlacement),
    bRollSuggestions: asStringArray(raw.bRollSuggestions),
    transitionType: asString(raw.transitionType),
  };
}

export async function GET(
  _req: NextRequest,
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

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        project: {
          userId,
        },
      },
      select: {
        id: true,
        projectId: true,
        scriptId: true,
        createdAt: true,
        updatedAt: true,
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

    const panels: StoryboardPanelResponse[] = storyboard.scenes.map((scene) =>
      normalizePanelFromRaw(scene.rawJson, scene.sceneNumber),
    );

    const validationReport = validateStoryboardAgainstGates(panels);

    const responseBody: { success: boolean; storyboard: StoryboardResponseBody } = {
      success: true,
      storyboard: {
        id: storyboard.id,
        projectId: storyboard.projectId,
        scriptId: storyboard.scriptId,
        createdAt: storyboard.createdAt.toISOString(),
        updatedAt: storyboard.updatedAt.toISOString(),
        panels,
        validationReport,
      },
    };

    console.log("[api/storyboards] response shape", {
      storyboardId: storyboard.id,
      sceneCountFromDb: storyboard.scenes.length,
      firstSceneRawJson: storyboard.scenes[0]?.rawJson ?? null,
      panelsCount: panels.length,
      firstPanel: panels[0] ?? null,
      responseKeys: Object.keys(responseBody.storyboard),
    });

    return NextResponse.json(
      responseBody,
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to fetch storyboard" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    const payload = await req.json().catch(() => null);
    const rawPanels = Array.isArray((payload as Record<string, unknown> | null)?.panels)
      ? ((payload as Record<string, unknown>).panels as unknown[])
      : null;
    if (!rawPanels) {
      return NextResponse.json({ error: "panels array is required" }, { status: 400 });
    }
    if (rawPanels.length === 0) {
      return NextResponse.json({ error: "panels cannot be empty" }, { status: 400 });
    }

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        project: { userId },
      },
      select: {
        id: true,
        projectId: true,
        scriptId: true,
      },
    });

    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
    }

    const panels = rawPanels.map((panel, index) => normalizePanelFromInput(panel, index));

    await prisma.$transaction(async (tx) => {
      await tx.storyboardScene.deleteMany({
        where: { storyboardId: storyboard.id },
      });

      for (let index = 0; index < panels.length; index += 1) {
        await tx.storyboardScene.create({
          data: {
            storyboardId: storyboard.id,
            sceneNumber: index + 1,
            // TODO: Restore after panelType migration runs.
            // panelType: panels[index].panelType,
            status: "ready",
            rawJson: panels[index] as unknown as Prisma.InputJsonValue,
          },
        });
      }

      await tx.storyboard.update({
        where: { id: storyboard.id },
        data: {
          scriptId: storyboard.scriptId ?? null,
        },
      });
    });

    const updated = await prisma.storyboard.findFirst({
      where: {
        id: storyboard.id,
        project: { userId },
      },
      select: {
        id: true,
        projectId: true,
        scriptId: true,
        createdAt: true,
        updatedAt: true,
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

    if (!updated) {
      return NextResponse.json({ error: "Storyboard not found after update" }, { status: 404 });
    }

    const responsePanels = updated.scenes.map((scene) =>
      normalizePanelFromRaw(scene.rawJson, scene.sceneNumber),
    );
    const validationReport = validateStoryboardAgainstGates(responsePanels);

    return NextResponse.json(
      {
        success: true,
        storyboard: {
          id: updated.id,
          projectId: updated.projectId,
          scriptId: updated.scriptId,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          panels: responsePanels,
          validationReport,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update storyboard" },
      { status: 500 },
    );
  }
}
