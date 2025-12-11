import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/getSessionUser';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';

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

  return NextResponse.json(project, { status: 201 });
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
