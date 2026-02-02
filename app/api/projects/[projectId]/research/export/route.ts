import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
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

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  const where: { projectId: string; jobId?: string } = { projectId };
  if (jobId) {
    where.jobId = jobId;
  }

  const rows = await prisma.researchRow.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      type: true,
      source: true,
      content: true,
      metadata: true,
      createdAt: true
    }
  });

  const headers = ['Type', 'Source', 'Content', 'Score', 'Created At'];
  const csvRows = rows.map((row) => [
    row.type ?? '',
    row.source,
    `"${(row.content || '').replace(/"/g, '""')}"`,
    (row.metadata as any)?.score || 0,
    row.createdAt.toISOString()
  ]);

  const csv = [headers.join(','), ...csvRows.map((row) => row.join(','))].join('\n');
  const filename = jobId ? `research-${jobId}.csv` : 'research-all.csv';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
