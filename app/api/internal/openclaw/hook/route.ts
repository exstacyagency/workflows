import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import prisma from "@/lib/prisma";

function isLocalhostRequest(req: NextRequest): boolean {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const remoteCandidates = forwardedFor
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const host = req.headers.get("host") ?? "";
  const localHost = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");

  if (remoteCandidates.length === 0) return localHost;

  return remoteCandidates.every(
    (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "localhost",
  );
}

function verifySecret(req: NextRequest): boolean {
  const secret = String(cfg.raw("INTERNAL_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) return true;
  const provided = String(req.headers.get("x-internal-secret") ?? "").trim();
  return provided.length > 0 && provided === secret;
}

export async function POST(req: NextRequest) {
  if (!isLocalhostRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!verifySecret(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    sessionKey?: string;
    payload?: Record<string, unknown>;
  } | null;

  const action = String(body?.action ?? "").trim();
  const sessionKey = String(body?.sessionKey ?? "").trim();
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  if (!action || !sessionKey) {
    return NextResponse.json({ error: "action and sessionKey are required" }, { status: 400 });
  }

  const legacyMatch = sessionKey.match(/^webchat:user-([^:]+):project-([^:]+)$/);
  const currentMatch = sessionKey.match(/^agent:main:webchat-(.+)$/);
  if (!legacyMatch && !currentMatch) {
    return NextResponse.json({ error: "Invalid sessionKey format" }, { status: 400 });
  }

  const userId = legacyMatch ? legacyMatch[1] : currentMatch![1];
  const payloadProjectId = String((payload as Record<string, unknown>)?.projectId ?? "").trim();
  const projectId = legacyMatch ? legacyMatch[2] : payloadProjectId;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required in payload for this sessionKey format" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const internalBaseUrl = String(cfg.raw("INTERNAL_APP_URL") ?? "http://localhost:3000").trim();
  const internalSecret = String(cfg.raw("INTERNAL_WEBHOOK_SECRET") ?? "").trim();
  const internalHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "x-internal-user-id": userId,
    ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
  };

  switch (action) {
    case "script-generation": {
      const res = await fetch(`${internalBaseUrl}/api/jobs/script-generation`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ projectId, ...(payload ?? {}) }),
      });
      const result = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: res.ok, result }, { status: res.ok ? 200 : res.status });
    }

    case "video-generation": {
      const res = await fetch(`${internalBaseUrl}/api/jobs/video-generation`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ projectId, ...(payload ?? {}) }),
      });
      const result = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: res.ok, result }, { status: res.ok ? 200 : res.status });
    }

    case "get-project-summary": {
      const [runs, jobs] = await Promise.all([
        prisma.research_run.findMany({
          where: { projectId, status: "IN_PROGRESS" },
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.job.findMany({
          where: { projectId, status: "RUNNING" },
          select: { id: true, type: true, estimatedCost: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      return NextResponse.json({ ok: true, runs, runningJobs: jobs });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
