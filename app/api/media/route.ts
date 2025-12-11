import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/getSessionUser';
import { prisma } from '@/lib/prisma';
import { getSignedMediaUrl } from '@/lib/mediaStorage';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');

  if (!key || key.length > 1024) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  const scriptMatch = await prisma.script.findFirst({
    where: {
      project: { userId: user.id },
      OR: [{ mergedVideoUrl: key }, { upscaledVideoUrl: key }],
    },
    select: { id: true },
  });

  const storyboardSceneMatch = scriptMatch
    ? null
    : await prisma.storyboardScene.findFirst({
        where: {
          videoUrl: key,
          storyboard: {
            project: { userId: user.id },
          },
        },
        select: { id: true },
      });

  const ownsKey = Boolean(scriptMatch || storyboardSceneMatch);

  if (!ownsKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = await getSignedMediaUrl(key, 60 * 5);
  return NextResponse.json({ url }, { status: 200 });
}
