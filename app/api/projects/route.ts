import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/getSessionUser';
import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let name = '';
  try {
    const body = await request.json();
    name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 },
      );
    }

    const data: Record<string, any> = { name, userId: user.id };
    if (typeof body.description === 'string') {
      data.description = body.description;
    }
    const project = await prisma.project.create({
      data,
    });

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    await logAudit({
      userId: user.id,
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
      userId: user.id,
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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(projects);
}
