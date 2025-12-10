import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { purgeCustomerProfileArchives } from '@/lib/customerAnalysisService';

type Params = {
  params: { projectId: string; intelId: string };
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const { projectId, intelId } = params;
  if (!projectId || !intelId) {
    return NextResponse.json({ error: 'projectId and intelId are required' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as 'archive' | 'restore' | undefined;
  if (!action || !['archive', 'restore'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Use "archive" or "restore".' }, { status: 400 });
  }

  const intel = await prisma.productIntelligence.findFirst({ where: { id: intelId, projectId } });
  if (!intel) {
    return NextResponse.json({ error: 'Product intelligence snapshot not found' }, { status: 404 });
  }

  if (action === 'archive') {
    await prisma.productIntelligence.update({ where: { id: intelId }, data: { archivedAt: new Date() } });
  } else {
    await prisma.productIntelligence.updateMany({
      where: { projectId, archivedAt: null, NOT: { id: intelId } },
      data: { archivedAt: new Date() },
    });
    await prisma.productIntelligence.update({ where: { id: intelId }, data: { archivedAt: null } });
  }

  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { projectId, intelId } = params;
  if (!projectId || !intelId) {
    return NextResponse.json({ error: 'projectId and intelId are required' }, { status: 400 });
  }

  const intel = await prisma.productIntelligence.findFirst({ where: { id: intelId, projectId } });
  if (!intel) {
    return NextResponse.json({ error: 'Product intelligence snapshot not found' }, { status: 404 });
  }

  await prisma.productIntelligence.delete({ where: { id: intelId } });
  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}
