import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";

function extractCookie(request?: any): string {
  if (!request) return "";
  // NextRequest (Edge API)
  if (typeof request.cookies?.get === "function") {
    const value = request.cookies.get("test_session")?.value || "";
    console.log("[requireSession] NextRequest cookie:", value);
    return value;
  }
  // Node.js Request
  if (typeof request.headers?.get === "function") {
    const raw = request.headers.get("cookie") || "";
    console.log("[requireSession] Node.js Request cookie header:", raw);
    const match = raw.match(/test_session=([^;]+)/);
    return match ? match[1] : "";
  }
  // Fallback: try direct property
  if (typeof request.headers?.cookie === "string") {
    const raw = request.headers.cookie;
    console.log("[requireSession] Direct cookie property:", raw);
    const match = raw.match(/test_session=([^;]+)/);
    return match ? match[1] : "";
  }
  return "";
}

export async function requireSession(request?: any) {
  console.log("[requireSession] ENV", { isDev: cfg.isDev, MODE: cfg.MODE, NODE_ENV: cfg.nodeEnv });
  // Accept test_session cookie directly in test/beta/dev mode
  if (cfg.isDev || cfg.MODE === "beta" || cfg.MODE === "test") {
    const token = extractCookie(request);
    console.log("[requireSession] Extracted test_session token:", token);
    if (token) {
      const testSession = await db.testSession.findUnique({ where: { token } });
      console.log("[requireSession] DB testSession:", testSession);
      if (testSession) {
        return { user: { id: testSession.userId } };
      }
    }
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!session || !userId) return null;
  return session;
}
