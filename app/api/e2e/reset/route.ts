import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/config";

/**
 * HARD RULES
 * - Must never run in production
 * - Must bypass auth & middleware
 * - Must be explicit and dumb
 */

export async function POST(req: NextRequest) {
  // Absolute kill switch for prod
  if (cfg.raw("NODE_ENV") === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Shared-secret guard (local / CI only)
  const expected = cfg.raw("E2E_RESET_KEY");
  if (expected) {
    const key = req.headers.get("x-e2e-reset-key");
    if (key !== expected) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  // === RESET LOGIC GOES HERE ===
  // await resetAndSeedDatabase();

  return NextResponse.json({ ok: true });
}