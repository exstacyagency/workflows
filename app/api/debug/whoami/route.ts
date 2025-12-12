import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      now: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,
      devTestMode: process.env.FF_DEV_TEST_MODE === "true",
      breakerTest: process.env.FF_BREAKER_TEST === "true",
      simulateLlmFail: process.env.FF_SIMULATE_LLM_FAIL === "true",
      simulateLlmHang: process.env.FF_SIMULATE_LLM_HANG === "true",
      llmBreakerFails: process.env.LLM_BREAKER_FAILS ?? null,
      llmTimeoutMs: process.env.LLM_TIMEOUT_MS ?? null,
      pid: process.pid,
    },
    { status: 200 }
  );
}
