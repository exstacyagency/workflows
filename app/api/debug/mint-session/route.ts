import { NextRequest, NextResponse } from "next/server";
import { encode as defaultEncode, getToken } from "next-auth/jwt";
import { cfg } from "@/lib/config";
import { PrismaClient } from "@prisma/client";
import { authOptions } from "@/auth";

export const dynamic = "force-dynamic";

let prisma: PrismaClient | null = null;
function getPrisma() {
  // In dev, prevent creating tons of clients during hot reload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.__debugPrisma) g.__debugPrisma = new PrismaClient();
  return g.__debugPrisma as PrismaClient;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  // Hard block in production regardless of env mistakes.
  if (cfg.raw("NODE_ENV") === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const token = req.headers.get("x-debug-admin-token") ?? "";
  const adminToken = cfg.raw("DEBUG_ADMIN_TOKEN") ?? "";
  if (!adminToken || token !== adminToken) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "");
  const email = String(body?.email || "");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Use the exact secret NextAuth is configured with.
  // NextAuth commonly uses AUTH_SECRET/secret in authOptions, not NEXTAUTH_SECRET.
  const secret = cfg.raw("NEXTAUTH_SECRET") || cfg.raw("AUTH_SECRET") || "";
  if (!secret || typeof secret !== "string") {
    return NextResponse.json({ error: "Missing auth secret" }, { status: 500 });
  }

  // Derive cookie name from actual NextAuth config if customized.
  // NextAuth stores cookies under authOptions.cookies.sessionToken.name when set.
  const configuredCookieName =
    // @ts-expect-error next-auth types don't expose deep cookie config nicely
    authOptions?.cookies?.sessionToken?.name;
  const cookieName = configuredCookieName || "next-auth.session-token";

  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    sub: userId,
    email: email || user.email || undefined,
    iat: now,
    exp: now + 60 * 60 * 24,
  };

  // If authOptions defines custom jwt.encode, we MUST use it.
  // Otherwise NextAuth will reject the token and wipe the cookie.
  // @ts-expect-error next-auth types are loose here
  const customEncode = authOptions?.jwt?.encode;

  const jwt =
    typeof customEncode === "function"
      ? await customEncode({
          token: tokenPayload,
          secret,
          // NextAuth passes these through when calling custom encode.
          // @ts-expect-error
          maxAge: 60 * 60 * 24,
          // @ts-expect-error
          salt: cookieName,
        })
      : await defaultEncode({
          token: tokenPayload,
          secret,
          salt: cookieName,
        });

  // Validate immediately using NextAuth's decoder.
  // If this fails, NextAuth would wipe the cookie (what you're seeing).
  const probeReq = new NextRequest(req.url, {
    headers: {
      cookie: `${cookieName}=${jwt}`,
    },
  });
  const decoded = await getToken({
    req: probeReq,
    secret,
    cookieName,
  });
  if (!decoded?.sub) {
    return NextResponse.json(
      {
        error: "Minted token failed validation (NextAuth would clear it)",
        cookieName,
        hint:
          "Token format mismatch. This endpoint now uses authOptions.jwt.encode when present. If it still fails, your auth uses a different cookieName/salt or rejects tokens via callbacks.",
      },
      { status: 500 }
    );
  }

  const isSecure = cookieName.startsWith("__Secure-") || cookieName.startsWith("__Host-");
  const res = NextResponse.json({
    ok: true,
    userId,
    email: email || user.email,
    cookieName,
    decodedSub: decoded.sub,
  });
  res.headers.append(
    "Set-Cookie",
    `${cookieName}=${jwt}; Path=/; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`
  );
  return res;
}
