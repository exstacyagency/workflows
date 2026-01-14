import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Never allow in prod
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const expected = process.env.E2E_RESET_KEY;

  if (expected) {
    const key = req.headers.get("x-e2e-reset-key");
    if (key !== expected) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  // TODO: reset DB here

  return NextResponse.json({ ok: true });
}