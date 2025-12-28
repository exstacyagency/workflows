import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { flag, nodeEnv } from "@/lib/flags";

export async function GET(_req: NextRequest) {
  if (cfg.raw("NODE_ENV") === "production") {
    return new Response(null, { status: 404 });
  }

  return NextResponse.json(
    {
      now: new Date().toISOString(),
      nodeEnv: nodeEnv(),
      devTestMode: flag("FF_DEV_TEST_MODE"),
      breakerTest: flag("FF_BREAKER_TEST"),
      simulateLlmFail: flag("FF_SIMULATE_LLM_FAIL"),
      simulateLlmHang: flag("FF_SIMULATE_LLM_HANG"),
      llmBreakerFails: cfg.raw("LLM_BREAKER_FAILS") ?? null,
      llmTimeoutMs: cfg.raw("LLM_TIMEOUT_MS") ?? null,
      pid: process.pid,
    },
    { status: 200 }
  );
}
