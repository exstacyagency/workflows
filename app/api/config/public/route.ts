import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";

export async function GET() {
  const openClawWsUrl =
    String(cfg.raw("OPENCLAW_WS_URL") ?? "").trim() ||
    "ws://localhost:18789/webchat";

  return NextResponse.json({ ok: true, openClawWsUrl });
}
