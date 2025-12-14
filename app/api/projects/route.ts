import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/logger';
import { CreateProjectSchema, parseJson } from '@/lib/validation/projects';
import { checkRateLimit } from '@/lib/rateLimiter';

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = await parseJson(request, CreateProjectSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { name, description } = parsed.data;

    const rateKey = `project:create:${userId}`;
    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(rateKey);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          { status: 429 },
        );
      }
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: description ?? undefined,
        userId,
      },
    });

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    await logAudit({
      userId,
      projectId: project.id,
      action: 'project.create',
      ip,
      metadata: {
        name,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Failed to create project', error);
    await logAudit({
      userId,
      action: 'project.error',
      metadata: {
        error: String(error),
      },
    });
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 },
    );
  }
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(projects);
}
