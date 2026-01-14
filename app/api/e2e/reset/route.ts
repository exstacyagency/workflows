import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/config";

export async function POST(req: NextRequest) {
  // Absolute kill switch for prod
  if (cfg.raw("NODE_ENV") === "production") {
    return NextResponse.json(
      { error: "Not allowed" },
      { status: 403 }
    );
  }

  // Optional shared-secret guard (local / CI only)
  const expected = cfg.raw("E2E_RESET_KEY");
  if (expected) {
    const key = req.headers.get("x-e2e-reset-key");
    if (key !== expected) {
      return NextResponse.json(
        { error: "Not allowed" },
        { status: 403 }
      );
    }
  }

  // === RESET LOGIC GOES HERE ===
  // await resetAndSeedDatabase();

  return NextResponse.json({ ok: true });
}