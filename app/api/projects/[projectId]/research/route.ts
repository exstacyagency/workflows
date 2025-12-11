import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

type Params = {
  params: { projectId: string };
};

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = params;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const researchRows = await prisma.researchRow.findMany({
    where: { projectId },
    orderBy: [{ source: 'asc' }, { createdAt: 'desc' }]
  });

  const grouped = researchRows.reduce<Record<string, typeof researchRows>>((acc, row) => {
    acc[row.source] = acc[row.source] ? [...acc[row.source], row] : [row];
    return acc;
  }, {});

  return NextResponse.json({ project, researchRows, grouped });
}
