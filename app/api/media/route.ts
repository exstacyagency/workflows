import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { prisma } from '@/lib/prisma';
import { getSignedMediaUrl } from '@/lib/mediaStorage';

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');

  if (!key || key.length > 1024) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  const scriptMatch = await prisma.script.findFirst({
    where: {
      project: { userId },
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
            project: { userId },
          },
        },
        select: { id: true },
      });

  const ownsKey = Boolean(scriptMatch || storyboardSceneMatch);

  if (!ownsKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const bucket = process.env.S3_MEDIA_BUCKET;
  const region = process.env.S3_MEDIA_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  const hasBucket = Boolean(bucket && bucket.trim());
  const hasRegion = Boolean(region && region.trim());
  const hasAccessKeyId = Boolean(accessKeyId && accessKeyId.trim());
  const hasSecretAccessKey = Boolean(secretAccessKey && secretAccessKey.trim());

  if (!hasBucket || !hasRegion || hasAccessKeyId !== hasSecretAccessKey) {
    return NextResponse.json(
      { error: 'Media signing not configured' },
      { status: 503 },
    );
  }

  try {
    const url = await getSignedMediaUrl(key, 60 * 5);
    return NextResponse.json({ url }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Media signing not configured' },
      { status: 503 },
    );
  }
}
