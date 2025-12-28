import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  if (cfg.raw("NODE_ENV") === "production") {
    return new NextResponse(null, { status: 404 });
  }
  if (cfg.raw("DISABLE_DEV_ADMIN") === "true" || cfg.raw("DISABLE_DEV_ADMIN") === "1") {
    return NextResponse.json({ error: "Dev admin disabled" }, { status: 403 });
  }

  const url = new URL(req.url);
  const expected = (cfg.raw("DEBUG_ADMIN_TOKEN") ?? "").trim();
  const got =
    (req.headers.get("x-debug-admin-token") ?? "").trim() ||
    (url.searchParams.get("token") ?? "").trim();
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let all = false;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object") {
      const value = (body as any).all;
      if (value !== undefined) {
        if (typeof value !== "boolean") {
          return NextResponse.json(
            { error: "Invalid all flag" },
            { status: 400 }
          );
        }
        all = value;
      }
    }
  } catch {
    // Body is optional.
  }

  const email = (url.searchParams.get("email") ?? "").trim();
  if (!all && (!email || typeof email !== "string" || email.trim().length === 0)) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 }
    );
  }

  try {
    const result = all
      ? await prisma.authThrottle.deleteMany({})
      : await prisma.authThrottle.deleteMany({
          where: {
            OR: [
              { identifier: { equals: email!, mode: "insensitive" } },
              { identifier: { contains: email!, mode: "insensitive" } },
            ],
          },
        });

    return NextResponse.json(
      { ok: true, deletedCount: result.count },
      { status: 200 }
    );
  } catch (err) {
    console.error("clear-lockout failed", err);
    return NextResponse.json(
      { error: "Failed to clear lockout" },
      { status: 500 }
    );
  }
}
