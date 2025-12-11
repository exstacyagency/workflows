// app/api/projects/[projectId]/pattern-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

type Params = {
  params: {
    projectId: string;
  };
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { projectId } = params;

  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId is required' },
      { status: 400 },
    );
  }

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
