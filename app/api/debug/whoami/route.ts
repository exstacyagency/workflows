import { NextRequest, NextResponse } from "next/server";
import { flag, nodeEnv } from "@/lib/flags";

export async function GET(_req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      now: new Date().toISOString(),
      nodeEnv: nodeEnv(),
      devTestMode: flag("FF_DEV_TEST_MODE"),
      breakerTest: flag("FF_BREAKER_TEST"),
      simulateLlmFail: flag("FF_SIMULATE_LLM_FAIL"),
      simulateLlmHang: flag("FF_SIMULATE_LLM_HANG"),
      llmBreakerFails: process.env.LLM_BREAKER_FAILS ?? null,
      llmTimeoutMs: process.env.LLM_TIMEOUT_MS ?? null,
      pid: process.pid,
    },
    { status: 200 }
  );
}
