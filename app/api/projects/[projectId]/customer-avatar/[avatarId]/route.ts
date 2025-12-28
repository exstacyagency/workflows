import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { purgeCustomerProfileArchives } from '@/lib/customerAnalysisService';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import {
  CustomerAvatarActionSchema,
  parseJson,
} from '@/lib/validation/projects';

type Params = {
  params: { projectId: string; avatarId: string };
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, avatarId } = params;
  if (!projectId || !avatarId) {
    return NextResponse.json({ error: 'projectId and avatarId are required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const parsed = await parseJson(req, CustomerAvatarActionSchema);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }
  const { action } = parsed.data;

  const avatar = await prisma.customerAvatar.findFirst({ where: { id: avatarId, projectId } });
  if (!avatar) {
    return NextResponse.json({ error: 'Customer avatar not found' }, { status: 404 });
  }

  if (action === 'archive') {
    await prisma.customerAvatar.update({ where: { id: avatarId }, data: { archivedAt: new Date() } });
  } else {
    await prisma.customerAvatar.updateMany({
      where: { projectId, archivedAt: null, NOT: { id: avatarId } },
      data: { archivedAt: new Date() },
    });
    await prisma.customerAvatar.update({ where: { id: avatarId }, data: { archivedAt: null } });
  }

  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, avatarId } = params;
  if (!projectId || !avatarId) {
    return NextResponse.json({ error: 'projectId and avatarId are required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const avatar = await prisma.customerAvatar.findFirst({ where: { id: avatarId, projectId } });
  if (!avatar) {
    return NextResponse.json({ error: 'Customer avatar not found' }, { status: 404 });
  }

  await prisma.customerAvatar.delete({ where: { id: avatarId } });
  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}
