import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { cfg } from "@/lib/config";
import { authSecret, sessionTokenCookieName } from "@/lib/auth/runtime";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublicAuthRoute =
    pathname === "/auth/signin" ||
    pathname === "/auth/signup" ||
    pathname.startsWith("/api/auth/");

  if (isPublicAuthRoute) {
    return NextResponse.next();
  }

  // Allow test routes in dev/beta
  if (pathname.startsWith("/api/test/")) {
    const mode =
      cfg.raw("NODE_ENV") !== "production" ||
      cfg.raw("MODE") === "beta" ||
      cfg.raw("MODE") === "test";
    if (mode) return NextResponse.next();
  }

  // Check test session in dev/beta
  const mode =
    cfg.raw("NODE_ENV") !== "production" ||
    cfg.raw("MODE") === "beta" ||
    cfg.raw("MODE") === "test";

  if (mode) {
    const testSession = req.cookies.get("test_session")?.value;
    if (testSession) return NextResponse.next();
  }

  // Get token
  const token = await getToken({
    req,
    secret: authSecret,
    cookieName: sessionTokenCookieName,
  });

  if (!token) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
