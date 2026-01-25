import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";

export async function GET() {
  if (cfg.mode !== "beta") {
    return NextResponse.json(
      { error: "Test env endpoint is only available in beta mode." },
      { status: 403 }
    );
  }
  return NextResponse.json({
    mode: cfg.mode,
    nodeEnv: cfg.nodeEnv,
    message: "env debug"
  });
}
