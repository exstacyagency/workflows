import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Only available when not in production
  if (cfg().env === "production") {
    return new NextResponse(null, { status: 404 });
  }

  // Optional shared-secret guard (local / CI only)
  const expectedKey = cfg().raw("E2E_RESET_KEY");
  if (expectedKey) {
    const providedKey = request.headers.get("x-e2e-reset-key");
    if (providedKey !== expectedKey) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  return NextResponse.json({ ok: true, env: cfg().env });
}
