// app/api/jobs/storyboard-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().min(1).optional(),
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

  let scriptIdUsed: string | null = null;

  if (scriptId) {
    const script = await prisma.script.findFirst({
      where: { id: scriptId, projectId },
      select: { id: true, projectId: true },
    });
    if (!script) {
      const byId = await prisma.script.findUnique({
        where: { id: scriptId },
        select: { id: true, projectId: true },
      });
      if (byId) {
        return NextResponse.json(
          {
            error: 'Script does not belong to project',
            scriptId,
            scriptProjectId: byId.projectId,
            requestedProjectId: projectId,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: 'Script not found', scriptId },
        { status: 404 },
      );
    }
    scriptIdUsed = script.id;
  } else {
    const latest = await prisma.script.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      return NextResponse.json(
        {
          error: 'No script exists for project. Run script-generation first.',
          projectId,
        },
        { status: 400 },
      );
    }
    scriptIdUsed = latest.id;
  }

  const existing = await prisma.storyboard.findFirst({
    where: { scriptId: scriptIdUsed },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { ok: true, storyboardId: existing.id, scriptIdUsed, reused: true },
      { status: 200 },
    );
  }

  const storyboard = await prisma.storyboard.create({
    data: {
      projectId,
      scriptId: scriptIdUsed,
    },
  });

  return NextResponse.json(
    { ok: true, storyboardId: storyboard.id, scriptIdUsed, reused: false },
    { status: 200 },
  );
}
