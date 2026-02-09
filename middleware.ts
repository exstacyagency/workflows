import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip auth routes completely
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow test bootstrap in beta/test/dev
  if (pathname.startsWith("/api/test/")) {
    const mode =
      process.env.NODE_ENV !== "production" ||
      process.env.MODE === "beta" ||
      process.env.MODE === "test";
    if (mode) return NextResponse.next();
  }

  // Check for test session cookie in beta/test/dev
  const mode =
    process.env.NODE_ENV !== "production" ||
    process.env.MODE === "beta" ||
    process.env.MODE === "test";

  if (mode) {
    const testSession = req.cookies.get("test_session")?.value;
    if (testSession) return NextResponse.next();
  }

  // Get token using getToken (more reliable than withAuth)
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET
  });

  if (!token) {
    const signInUrl = new URL("/api/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/studio/:path*",
    "/api/jobs/:path*",
    "/api/projects/:path*",
    "/api/test/:path*",
  ],
};