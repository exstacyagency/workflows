
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  const deny = await requireProjectOwner404(projectId);
  if (deny) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
