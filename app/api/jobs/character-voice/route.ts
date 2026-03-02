import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { JobStatus, JobType } from "@prisma/client";
import { enforceUserConcurrency, findIdempotentJob } from "@/lib/jobGuards";

const BodySchema = z.object({
  projectId: z.string().min(1),
  productId: z.string().min(1),
  characterId: z.string().min(1),
  runId: z.string().optional(),
  forceNew: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { projectId, productId, characterId, forceNew } = parsed.data;
  const runId = String(parsed.data.runId ?? "").trim() || null;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!cfg.raw("ELEVENLABS_API_KEY")) {
    return NextResponse.json({ error: "ElevenLabs is not configured" }, { status: 500 });
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      productId: true,
      name: true,
      creatorVisualPrompt: true,
      seedVideoUrl: true,
      elevenLabsVoiceId: true,
    },
  });

  if (!character || character.productId !== productId) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  if (character.elevenLabsVoiceId && !forceNew) {
    return NextResponse.json(
      {
        error: "Character already has a voice profile",
        elevenLabsVoiceId: character.elevenLabsVoiceId,
      },
      { status: 409 },
    );
  }

  const concurrency = await enforceUserConcurrency(userId);
  if (!concurrency.allowed) return NextResponse.json({ error: concurrency.reason }, { status: 429 });

  const forceNonce = forceNew ? crypto.randomUUID() : null;
  const idempotencyKey = JSON.stringify([
    projectId,
    JobType.CHARACTER_VOICE_SETUP,
    characterId,
    ...(forceNonce ? [`force:${forceNonce}`] : []),
  ]);

  const existing = await findIdempotentJob({
    userId,
    projectId,
    type: JobType.CHARACTER_VOICE_SETUP,
    idempotencyKey,
  });
  if (existing) {
    return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      userId,
      type: JobType.CHARACTER_VOICE_SETUP,
      status: JobStatus.PENDING,
      idempotencyKey,
      ...(runId ? { runId } : {}),
      payload: {
        projectId,
        productId,
        characterId,
        characterName: character.name,
        creatorVisualPrompt: character.creatorVisualPrompt ?? "",
        seedVideoUrl: character.seedVideoUrl ?? "",
        runId,
      },
    },
  });

  return NextResponse.json({ ok: true, jobId: job.id, reused: false }, { status: 200 });
}
