import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { prisma } from '@/lib/prisma';
import { getSignedMediaUrl } from '@/lib/mediaStorage';
import { getRequestId, logError, logInfo } from "@/lib/observability";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  logInfo("api.request", { requestId, path: req.nextUrl?.pathname });

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

  try {
    const url = await getSignedMediaUrl(key, 60 * 5);
    return NextResponse.json({ url }, { status: 200 });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.includes("S3 media signing not configured in production")) {
      logError("api.error", err, { requestId, path: req.nextUrl?.pathname });
      return NextResponse.json(
        { error: "Media signing not configured" },
        { status: 503 }
      );
    }

    logError("api.error", err, { requestId, path: req.nextUrl?.pathname });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
