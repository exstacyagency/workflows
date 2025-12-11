import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { purgeCustomerProfileArchives } from '@/lib/customerAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import {
  ProductIntelligenceActionSchema,
  parseJson,
} from '@/lib/validation/projects';

type Params = {
  params: { projectId: string; intelId: string };
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const { projectId, intelId } = params;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  if (!projectId || !intelId) {
    return NextResponse.json({ error: 'projectId and intelId are required' }, { status: 400 });
  }

  const parsed = await parseJson(req, ProductIntelligenceActionSchema);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }
  const { action } = parsed.data;

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

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

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
