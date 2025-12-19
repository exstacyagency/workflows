// app/api/jobs/storyboard-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body', details: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, scriptId } = parsed.data;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    select: { id: true, projectId: true },
  });
  if (!script || script.projectId !== projectId) {
    return NextResponse.json(
      { error: 'Script or project not found' },
      { status: 404 },
    );
  }

  const existing = await prisma.storyboard.findFirst({
    where: { scriptId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { storyboardId: existing.id, reused: true },
      { status: 200 },
    );
  }

  const storyboard = await prisma.storyboard.create({
    data: {
      projectId,
      scriptId,
    },
  });

  return NextResponse.json(
    { ok: true, storyboardId: storyboard.id, reused: false },
    { status: 200 },
  );
}
