import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { checkRateLimit } from "@/lib/rateLimiter";
import { isAdminRequest } from "@/lib/admin/isAdminRequest";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const awaitedParams = await params;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, jobId } = awaitedParams;
  if (!projectId || !jobId) {
    return NextResponse.json({ error: "projectId and jobId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rate = await checkRateLimit(`deadletter:clear-attempts:${userId}`, {
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.reason ?? "Rate limit exceeded" }, { status: 429 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, payload: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload: any = job.payload ?? {};
  payload.attempts = 0;
  payload.nextRunAt = null;

  await prisma.job.update({
    where: { id: jobId },
    data: { payload },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
