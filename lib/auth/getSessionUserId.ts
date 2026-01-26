
import { cookies, headers } from "next/headers"
import { getAuthSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { cfg } from "@/lib/config"

export async function getSessionUserId(
  request?: Request
): Promise<string | null> {
  // ---- TEST / DEV BYPASS ----
  const runtimeMode =
    cfg.RUNTIME_MODE ??
    cfg.MODE ??
    cfg.mode ??
    cfg.env ??
    "dev"

  const path =
    request?.headers.get("x-pathname") ??
    headers().get("x-pathname") ??
    ""

  if (runtimeMode !== "prod" || path.startsWith("/api/test")) {
    const user = await db.user.upsert({
      where: { email: "test@local.dev" },
      update: {},
      create: {
        email: "test@local.dev",
        name: "Test User"
      }
    })
    return user.id
  }

  // ---- TEST SESSION COOKIE ----
  const cookieStore = cookies()
  const testToken = cookieStore.get("test_session")?.value

  if (cfg.env !== "production" && testToken) {
    const session = await db.testSession.findUnique({
      where: { token: testToken }
    })
    if (!session) return null
    return session.userId
  }

  // ---- REAL AUTH ----
  if (!request) return null

  const session = await getAuthSession();
  return session?.user?.id ?? null
}
