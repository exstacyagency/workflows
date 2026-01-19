import { NextResponse } from "next/server";
import { assertRuntimeMode } from "@/src/runtime/assertMode";

// Keep this endpoint intentionally dependency-light and unauthenticated.
// CI/E2E uses it as the single readiness gate.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  assertRuntimeMode();
  return NextResponse.json(
    {
      ok: true,
      ts: new Date().toISOString(),
    },
    { status: 200 },
  );
}
