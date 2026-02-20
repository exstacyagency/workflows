import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
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

    const body = await req.json().catch(() => null);
    const rawPrompts = Array.isArray((body as Record<string, unknown> | null)?.prompts)
      ? ((body as Record<string, unknown>).prompts as unknown[])
      : null;
    if (!rawPrompts) {
      return NextResponse.json({ error: "prompts array is required" }, { status: 400 });
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
            id: true,
            rawJson: true,
          },
        },
      },
    });

    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
    }

    if (rawPrompts.length !== storyboard.scenes.length) {
      return NextResponse.json(
        {
          error: `prompts length mismatch. Expected ${storyboard.scenes.length}, received ${rawPrompts.length}.`,
        },
        { status: 400 },
      );
    }

    const promptEntries = rawPrompts.map((entry) => {
      const raw = asObject(entry) ?? {};
      return {
        panelIndex: Number(raw.panelIndex),
        firstFramePrompt: asString(raw.firstFramePrompt),
        lastFramePrompt: asString(raw.lastFramePrompt),
      };
    });

    for (const entry of promptEntries) {
      if (!Number.isInteger(entry.panelIndex) || entry.panelIndex < 0 || entry.panelIndex >= storyboard.scenes.length) {
        return NextResponse.json(
          { error: "Each prompt entry must include a valid panelIndex in range." },
          { status: 400 },
        );
      }
    }

    const promptByPanelIndex = new Map<number, { firstFramePrompt: string; lastFramePrompt: string }>();
    for (const entry of promptEntries) {
      promptByPanelIndex.set(entry.panelIndex, {
        firstFramePrompt: entry.firstFramePrompt,
        lastFramePrompt: entry.lastFramePrompt,
      });
    }

    await prisma.$transaction(
      storyboard.scenes.map((scene, panelIndex) => {
        const next = promptByPanelIndex.get(panelIndex) ?? { firstFramePrompt: "", lastFramePrompt: "" };
        const raw = asObject(scene.rawJson) ?? {};
        const nextRaw = {
          ...raw,
          firstFramePrompt: next.firstFramePrompt,
          lastFramePrompt: next.lastFramePrompt,
        };
        return prisma.storyboardScene.update({
          where: { id: scene.id },
          data: {
            rawJson: nextRaw as Prisma.InputJsonValue,
          },
        });
      }),
    );

    return NextResponse.json({
      success: true,
      prompts: storyboard.scenes.map((scene, panelIndex) => {
        const next = promptByPanelIndex.get(panelIndex) ?? { firstFramePrompt: "", lastFramePrompt: "" };
        return {
          sceneId: scene.id,
          panelIndex,
          firstFramePrompt: next.firstFramePrompt,
          lastFramePrompt: next.lastFramePrompt,
        };
      }),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update image prompts" },
      { status: 500 },
    );
  }
}
