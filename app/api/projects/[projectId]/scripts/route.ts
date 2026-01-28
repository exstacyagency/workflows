
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { getSignedMediaUrl } from '@/lib/mediaStorage';

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  const deny = await requireProjectOwner404(projectId);
  if (deny) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
