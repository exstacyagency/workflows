import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/getSessionUser";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { checkRateLimit } from "@/lib/rateLimiter";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getSessionUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rate = await checkRateLimit(`deadletter:bulk:${user.id}`, {
    limit: 3,
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.reason ?? "Rate limit exceeded" }, { status: 429 });
  }

  const { projectId } = params;
  const auth = await requireProjectOwner(projectId);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  if (!action || !["dismiss_all", "clear_attempts_all", "retry_all_transient"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const jobs = await prisma.job.findMany({
    where: { projectId, status: "FAILED" },
    select: { id: true, payload: true, error: true },
    take: 500,
  });

  const rows = jobs
    .map((j) => {
      const p: any = j.payload ?? {};
      return {
        id: j.id,
        payload: p,
        error: j.error ?? p.lastError ?? "",
        dismissed: Boolean(p.dismissed ?? false),
      };
    })
    .filter((j) => !j.dismissed);

  function isPermanent(msg: string) {
    const m = String(msg ?? "").toLowerCase();
    return (
      m.includes("missing dependencies") ||
      m.includes("must be set in .env") ||
      m.includes("redis_url missing") ||
      m.includes("redis not configured") ||
      m.includes("required") ||
      m.includes("forbidden") ||
      m.includes("unauthorized")
    );
  }

  let updated = 0;
  let skipped = 0;

  for (const j of rows) {
    const payload: any = j.payload ?? {};

    if (action === "dismiss_all") {
      payload.dismissed = true;
      payload.dismissedAt = Date.now();
      const res = await prisma.job.updateMany({
        where: { id: j.id, projectId, status: "FAILED" },
        data: { payload },
      });
      if (res.count) updated += res.count;
      else skipped++;
      continue;
    }

    if (action === "clear_attempts_all") {
      payload.attempts = 0;
      payload.nextRunAt = null;
      const res = await prisma.job.updateMany({
        where: { id: j.id, projectId, status: "FAILED" },
        data: { payload },
      });
      if (res.count) updated += res.count;
      else skipped++;
      continue;
    }

    if (action === "retry_all_transient") {
      if (isPermanent(j.error)) {
        skipped++;
        continue;
      }
      payload.dismissed = false;
      payload.nextRunAt = Date.now() - 1000;
      const res = await prisma.job.updateMany({
        where: { id: j.id, projectId, status: "FAILED" },
        data: { status: "PENDING", error: null, payload },
      });
      if (res.count) updated += res.count;
      else skipped++;
      continue;
    }
  }

  return NextResponse.json({ ok: true, updated, skipped }, { status: 200 });
}
