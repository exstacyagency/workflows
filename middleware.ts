// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Safety net (should not be hit once matcher is fixed)
  if (
    pathname === "/api/health" ||
    pathname === "/api/e2e/reset" ||
    pathname.startsWith("/api/_e2e/")
  ) {
    return NextResponse.next();
  }

  const { withAuth } = await import("next-auth/middleware");

  const authMiddleware = withAuth({
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  });

  return authMiddleware(req as any) as Promise<NextResponse>;
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/customer-profile/:path*",
    "/studio/:path*",
    // 🚫 NO /api MATCHER
  ],
};