import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

type VoiceJobRow = {
  id: string;
  status: JobStatus;
  error: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toErrorString(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const characterId = req.nextUrl.searchParams.get("characterId")?.trim();
    if (!characterId) {
      return NextResponse.json({ error: "characterId is required" }, { status: 400 });
    }

    const character = await prisma.character.findFirst({
      where: {
        id: characterId,
        product: {
          project: { userId },
        },
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const rows = await prisma.$queryRaw<VoiceJobRow[]>`
      SELECT
        j."id",
        j."status",
        j."error",
        j."createdAt",
        j."updatedAt"
      FROM "job" j
      WHERE j."userId" = ${userId}
        AND j."type" = CAST('CHARACTER_VOICE_SETUP' AS "JobType")
        AND COALESCE(j."payload"->>'characterId', '') = ${characterId}
        AND (${character.projectId}::text IS NULL OR j."projectId" = ${character.projectId})
      ORDER BY j."createdAt" DESC
      LIMIT 1
    `;

    const row = rows[0] ?? null;

    return NextResponse.json(
      {
        characterId,
        stage: {
          type: JobType.CHARACTER_VOICE_SETUP,
          label: "Character Voice Setup",
          jobId: row?.id ?? null,
          status: row?.status ?? JobStatus.PENDING,
          error: toErrorString(row?.error),
          createdAt: row?.createdAt ?? null,
          updatedAt: row?.updatedAt ?? null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[character-voice/status] Error:", error);
    return NextResponse.json({ error: "Failed to fetch character voice status" }, { status: 500 });
  }
}
