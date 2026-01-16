import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  // Absolute, side-effect-free env detection
  const env =
    (globalThis as any)?.process?.env?.NODE_ENV ??
    "development";

  // Hard production kill switch
  if (env === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Optional shared-secret guard (local / CI only)
  const expectedKey =
    (globalThis as any)?.process?.env?.E2E_RESET_KEY;

  if (expectedKey) {
    const providedKey = request.headers.get("x-e2e-reset-key");
    if (providedKey !== expectedKey) {
      return NextResponse.json(
        { error: "Not allowed" },
        { status: 403 }
      );
    }
  }

  // Safe no-op reset response
  return NextResponse.json({
    ok: true,
    env,
  });
}