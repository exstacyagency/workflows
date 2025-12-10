import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined
    }
  });

  return NextResponse.json(project, { status: 201 });
}

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' }
  });
  return NextResponse.json(projects);
}
