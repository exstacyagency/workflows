import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";

export async function POST(req: NextRequest) {
  // Only allow in test/beta/dev mode
  if (!(cfg.isDev || cfg.MODE === "beta" || cfg.MODE === "test")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const body = await req.text();
  const params = new URLSearchParams(body);
  const token = params.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const testSession = await db.testSession.findUnique({ where: { token } });
  if (!testSession) {
    return NextResponse.json({ error: "Invalid test session" }, { status: 401 });
  }
  // Simulate NextAuth session cookie
  const sessionCookie = `next-auth.session-token=test-session-${token}; Path=/; HttpOnly; SameSite=Lax`;
  const res = NextResponse.json({ success: true, userId: testSession.userId });
  res.headers.append("set-cookie", sessionCookie);
  return res;
}
