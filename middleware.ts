import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { withAuth } from "next-auth/middleware";
import { cfg } from "@/lib/config";

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  return res;
}

const authMiddleware = withAuth(
  function middleware() {
    return applySecurityHeaders(NextResponse.next());
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent
) {
  const pathname = req.nextUrl.pathname;
  const env = cfg.env;
  const sweep = cfg.raw("SECURITY_SWEEP") === "1";

  // HARD BYPASSES — must stay first
  if (
    pathname === "/api/health" ||
    pathname.startsWith("/api/_e2e/")
  ) {
    return NextResponse.next();
  }

  // E2E reset (rewritten to /api/_dev/e2e/reset in dev only)
  if (pathname === "/api/e2e/reset") {
    if (env === "production" && !sweep) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/_dev/e2e/")) {
    if (env === "production" && !sweep) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // Debug routes
  if (
    pathname.startsWith("/api/debug/") &&
    (env !== "production" || sweep)
  ) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/api/debug/") &&
    env === "production" && !sweep
  ) {
    return new Response(null, { status: 404 });
  }

  if (
    pathname.startsWith("/api/_dev/debug/") &&
    (env !== "production" || sweep)
  ) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/api/_dev/debug/") &&
    env === "production" && !sweep
  ) {
    return new Response(null, { status: 404 });
  }

  // ✅ THIS IS THE KEY LINE
  return (await authMiddleware(
    req as any,
    event
  )) as NextResponse;
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/customer-profile/:path*",
    "/studio/:path*",
    "/api/:path*",
  ],
};