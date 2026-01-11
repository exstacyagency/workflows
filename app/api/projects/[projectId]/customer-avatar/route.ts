// app/api/projects/[projectId]/customer-avatar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

type Params = {
  params: { projectId: string };
};

function serializeAvatar(record: any) {
  const { persona, ...safe } = record;
  return { ...safe, hasPersona: Boolean(persona) };
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
    const avatars = await prisma.customerAvatar.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(avatars.map(serializeAvatar), { status: 200 });
  }

  const desiredId = req.nextUrl.searchParams.get('id');
  let avatar = null;
  if (desiredId) {
    avatar = await prisma.customerAvatar.findFirst({ where: { id: desiredId, projectId } });
  }

  if (!avatar) {
    const all = await prisma.customerAvatar.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    avatar = all.find((a) => !(a.persona as any)?.archivedAt) ?? all[0] ?? null;
  }

  if (!avatar) {
    return NextResponse.json(
      { error: 'No customer avatar found for this project' },
      { status: 404 },
    );
  }

  const download = req.nextUrl.searchParams.get('download');
  if (download === '1') {
    const payload = avatar.persona ?? avatar;
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
