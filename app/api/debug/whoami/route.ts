import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      now: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,
      devTestMode: process.env.FF_DEV_TEST_MODE === "true",
      pid: process.pid,
    },
    { status: 200 }
  );
}
