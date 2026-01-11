import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { purgeCustomerProfileArchives } from '@/lib/customerAnalysisService';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import {
  ProductIntelligenceActionSchema,
  parseJson,
} from '@/lib/validation/projects';

type Params = {
  params: { projectId: string; intelId: string };
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, intelId } = params;
  if (!projectId || !intelId) {
    return NextResponse.json({ error: 'projectId and intelId are required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

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
    const insights = (intel.insights as any) ?? {};
    insights.archivedAt = new Date().toISOString();
    await prisma.productIntelligence.update({ where: { id: intelId }, data: { insights } as any });
  } else {
    const others = await prisma.productIntelligence.findMany({ where: { projectId } });
    const now = new Date().toISOString();
    await Promise.all(
      others.map(async (o) => {
        const p = (o.insights as any) ?? {};
        if (o.id === intelId) {
          delete p.archivedAt;
        } else {
          p.archivedAt = now;
        }
        return prisma.productIntelligence.update({ where: { id: o.id }, data: { insights: p } as any });
      }),
    );
  }

  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, intelId } = params;
  if (!projectId || !intelId) {
    return NextResponse.json({ error: 'projectId and intelId are required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const intel = await prisma.productIntelligence.findFirst({ where: { id: intelId, projectId } });
  if (!intel) {
    return NextResponse.json({ error: 'Product intelligence snapshot not found' }, { status: 404 });
  }

  await prisma.productIntelligence.delete({ where: { id: intelId } });
  await purgeCustomerProfileArchives(projectId);

  return NextResponse.json({ success: true });
}
