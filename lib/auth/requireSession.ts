// lib/auth/requireSession.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";

function extractCookie(request?: any): string {
  if (!request) return "";
  if (typeof request.cookies?.get === "function") {
    const value = request.cookies.get("test_session")?.value || "";
    return value;
  }
  if (typeof request.headers?.get === "function") {
    const raw = request.headers.get("cookie") || "";
    const match = raw.match(/test_session=([^;]+)/);
    return match ? match[1] : "";
  }
  if (typeof request.headers?.cookie === "string") {
    const raw = request.headers.cookie;
    const match = raw.match(/test_session=([^;]+)/);
    return match ? match[1] : "";
  }
  return "";
}

export async function requireSession(request?: any) {
  if (cfg.isDev || cfg.MODE === "beta" || cfg.MODE === "test") {
    const token = extractCookie(request);
    if (token) {
      // Lazy load testStore only in non-prod
      const { getTestSession } = await import("@/lib/testStore");
      const memSession = getTestSession(token);
      if (memSession) {
        return { user: { id: memSession.userId } };
      }
      
      const testSession = await db.testSession.findUnique({ where: { token } });
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