// app/api/projects/[projectId]/scripts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { getSignedMediaUrl } from '@/lib/mediaStorage';

type Params = {
  params: { projectId: string };
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { projectId } = params;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const scripts = await prisma.script.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  const scriptsWithSignedUrls = await Promise.all(
    scripts.map(async script => ({
      ...script,
      mergedVideoUrl: await getSignedMediaUrl(script.mergedVideoUrl),
      upscaledVideoUrl: await getSignedMediaUrl(script.upscaledVideoUrl),
    })),
  );

  return NextResponse.json(scriptsWithSignedUrls, { status: 200 });
}
