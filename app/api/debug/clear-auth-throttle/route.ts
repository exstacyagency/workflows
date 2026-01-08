import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function getPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.__debugPrisma) g.__debugPrisma = new PrismaClient();
  return g.__debugPrisma as PrismaClient;
}

export async function POST(req: NextRequest) {
  if (cfg.raw("NODE_ENV") === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const token = req.headers.get("x-debug-admin-token") ?? "";
  const adminToken = cfg.raw("DEBUG_ADMIN_TOKEN") ?? "";
  if (!adminToken || token !== adminToken) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const prisma = getPrisma();

  // Model delegate is "authThrottle" in your Prisma client.
  // Clear any rows for this email. If your schema uses a different field name,
  // this will throw and you’ll need to tell me the actual columns.
  const result = await prisma.authThrottle.deleteMany({
    where: {
      OR: [
        // common patterns
        { email },
        { identifier: email },
        { key: email },
      ],
    },
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
