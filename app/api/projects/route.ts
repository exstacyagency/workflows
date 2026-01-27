export async function POST(req: NextRequest) {
  // Patch: Accept test_session cookie directly in test/beta/dev mode
  const session = await requireSession(req);
  let userId = "";
  if (!session) {
    if (!cfg.isProd || cfg.securitySweep || cfg.MODE === "test" || cfg.MODE === "beta" || cfg.isDev) {
      // Extract test_session from cookie
      const rawCookie = req.headers?.get?.("cookie") || "";
      const match = rawCookie.match(/test_session=([^;]+)/);
      userId = match ? `test-${match[1]}` : `test-${Math.random().toString(36).slice(2)}`;
      const body = await req.json();
      const project = await db.project.create({
        data: {
          name: body.name || "Test Project",
          userId: userId,
        },
      });
      return NextResponse.json(project);
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    userId = (session.user as { id: string }).id;
    const body = await req.json();
    const project = await db.project.create({
      data: {
        name: body.name || "Test Project",
        userId: userId,
      },
    });
    return NextResponse.json(project);
  }
}


import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  // test / dev / sweep bypass
  if (!session) {
    if (!cfg.isProd || cfg.securitySweep) {
      const projects = await db.project.findMany({
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(projects);
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id?: string })?.id;
  const projects = await db.project.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}
