// app/api/projects/[projectId]/customer-avatar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

type Params = {
  params: { projectId: string };
};

function serializeAvatar(record: any) {
  const { rawJson, ...safe } = record;
  return { ...safe, hasRaw: Boolean(rawJson) };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { projectId } = params;

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const view = req.nextUrl.searchParams.get('view');
  if (view === 'all') {
    const avatars = await prisma.customerAvatar.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(avatars.map(serializeAvatar), { status: 200 });
  }

  const desiredId = req.nextUrl.searchParams.get('id');
  let avatar = desiredId
    ? await prisma.customerAvatar.findFirst({ where: { id: desiredId, projectId } })
    : null;

  if (!avatar) {
    avatar = await prisma.customerAvatar.findFirst({
      where: { projectId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!avatar) {
    avatar = await prisma.customerAvatar.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!avatar) {
    return NextResponse.json(
      { error: 'No customer avatar found for this project' },
      { status: 404 },
    );
  }

  const download = req.nextUrl.searchParams.get('download');
  if (download === '1') {
    const payload = avatar.rawJson ?? avatar;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${projectId}-customer-avatar-${avatar.id}.json"`,
      },
    });
  }

  return NextResponse.json(serializeAvatar(avatar), { status: 200 });
}
