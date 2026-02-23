// app/api/projects/[projectId]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

type Params = {
  params: { projectId: string };
};

export async function GET(_req: NextRequest, { params }: Params) {
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

  const runId = String(_req.nextUrl.searchParams.get("runId") ?? "").trim();
  const productId = String(_req.nextUrl.searchParams.get("productId") ?? "").trim();

  const characters = await prisma.character.findMany({
    where: {
      projectId,
      ...(runId ? { runId } : {}),
      ...(productId ? { productId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      run: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json(characters, { status: 200 });
}
