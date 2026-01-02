import { NextResponse } from "next/server";

// Keep this endpoint intentionally dependency-light and unauthenticated.
// CI/E2E uses it as the single readiness gate.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      ts: new Date().toISOString(),
    },
    { status: 200 },
  );
}
