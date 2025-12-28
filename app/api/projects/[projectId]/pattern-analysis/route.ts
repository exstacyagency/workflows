// app/api/projects/[projectId]/pattern-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

type Params = {
  params: {
    projectId: string;
  };
};

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId is required' },
      { status: 400 },
    );
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const result = await prisma.adPatternResult.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  if (!result) {
    return NextResponse.json(
      { error: 'No pattern analysis found for this project' },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      id: result.id,
      projectId: result.projectId,
      baselineRetention3s: result.baselineRetention3s,
      baselineCtr: result.baselineCtr,
      totalConverters: result.totalConverters,
      rawJson: result.rawJson,
      createdAt: result.createdAt,
    },
    { status: 200 },
  );
}
