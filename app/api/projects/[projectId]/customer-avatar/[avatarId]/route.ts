import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { purgeCustomerProfileArchives } from '@/lib/customerAnalysisService';

type Params = {
  params: { projectId: string; avatarId: string };
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const { projectId, avatarId } = params;
  if (!projectId || !avatarId) {
    return NextResponse.json({ error: 'projectId and avatarId are required' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as 'archive' | 'restore' | undefined;
  if (!action || !['archive', 'restore'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Use "archive" or "restore".' }, { status: 400 });
  }

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
  const { projectId, avatarId } = params;
  if (!projectId || !avatarId) {
    return NextResponse.json({ error: 'projectId and avatarId are required' }, { status: 400 });
  }

  const avatar = await prisma.customerAvatar.findFirst({ where: { id: avatarId, projectId } });
  if (!avatar) {
    return NextResponse.json({ error: 'Customer avatar not found' }, { status: 404 });
  }

  await prisma.customerAvatar.delete({ where: { id: avatarId } });
  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}
