import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

type Params = {
  params: { projectId: string };
};

export async function GET(_request: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

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
