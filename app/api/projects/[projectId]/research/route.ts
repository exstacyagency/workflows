import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

type Params = {
  params: { projectId: string };
};

export async function GET(_request: Request, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { id: params.projectId } });
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const researchRows = await prisma.researchRow.findMany({
    where: { projectId: params.projectId },
    orderBy: [{ source: 'asc' }, { createdAt: 'desc' }]
  });

  const grouped = researchRows.reduce<Record<string, typeof researchRows>>((acc, row) => {
    acc[row.source] = acc[row.source] ? [...acc[row.source], row] : [row];
    return acc;
  }, {});

  return NextResponse.json({ project, researchRows, grouped });
}
