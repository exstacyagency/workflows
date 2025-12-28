// app/api/projects/[projectId]/product-intelligence/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

type Params = {
  params: { projectId: string };
};

function serializeIntel(record: any) {
  const { rawJson, ...safe } = record;
  return { ...safe, hasRaw: Boolean(rawJson) };
}

export async function GET(req: NextRequest, { params }: Params) {
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

  const view = req.nextUrl.searchParams.get('view');
  if (view === 'all') {
    const intelRows = await prisma.productIntelligence.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(intelRows.map(serializeIntel), { status: 200 });
  }

  const desiredId = req.nextUrl.searchParams.get('id');
  let intel = desiredId
    ? await prisma.productIntelligence.findFirst({ where: { id: desiredId, projectId } })
    : null;

  if (!intel) {
    intel = await prisma.productIntelligence.findFirst({
      where: { projectId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!intel) {
    intel = await prisma.productIntelligence.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!intel) {
    return NextResponse.json(
      { error: 'No product intelligence found for this project' },
      { status: 404 },
    );
  }

  const download = req.nextUrl.searchParams.get('download');
  if (download === '1') {
    const payload = intel.rawJson ?? intel;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${projectId}-product-intel-${intel.id}.json"`,
      },
    });
  }

  return NextResponse.json(serializeIntel(intel), { status: 200 });
}
