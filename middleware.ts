import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";
import { cfg } from "@/lib/config";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 🛡️ Allow test-only and isolation-test target routes (dev/test only)
  if (
    process.env.NODE_ENV !== "production" &&
    (
      pathname.startsWith("/api/test/") ||
      pathname.startsWith("/api/projects") ||
      pathname.startsWith("/api/jobs")
    )
  ) {
    return NextResponse.next();
  }
  // All other routes use withAuth
  return withAuth({
    pages: {
      signIn: "/api/auth/signin",
    },
    callbacks: {
      authorized: ({ token }) => {
        // All matched routes require auth
        return !!token;
      },
    },
  })(req);
}

// Explicitly scope auth to only the following routes
export const config = {
  matcher: [
    "/projects/:path*",
    "/studio/:path*",
    "/api/jobs/:path*",
    "/api/projects/:path*",
    "/api/test/:path*",
  ],
};