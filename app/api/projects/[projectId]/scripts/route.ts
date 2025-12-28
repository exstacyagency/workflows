// app/api/projects/[projectId]/scripts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { getSignedMediaUrl } from '@/lib/mediaStorage';

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
