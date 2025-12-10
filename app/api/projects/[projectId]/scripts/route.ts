// app/api/projects/[projectId]/scripts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type Params = {
  params: { projectId: string };
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { projectId } = params;

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const scripts = await prisma.script.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(scripts, { status: 200 });
}
