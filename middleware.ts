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

  const { isProd, isDev, isGolden, securitySweep } = cfg;
  const allowDebug = isDev || isGolden;
  const allowE2E = !isProd || securitySweep || isGolden;

  // HARD BYPASSES — must stay first
  if (
    pathname === "/api/health" ||
    pathname.startsWith("/api/_e2e/")
  ) {
    return NextResponse.next();
  }

  if (cfg.RUNTIME_MODE === "alpha") {
    if (pathname.startsWith("/billing")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Billing disabled in alpha" }, { status: 403 })
      );
    }
  }

  // Test-only debug routes must bypass NextAuth middleware; otherwise withAuth redirects before handler executes.
  if (!isProd && pathname.startsWith("/api/debug/")) {
    const res = applySecurityHeaders(NextResponse.next());
    return res;
  }
  // E2E reset (rewritten to /api/_dev/e2e/reset in dev only)
  if (pathname === "/api/e2e/reset") {
    if (!allowE2E) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/_dev/e2e/")) {
    if (!allowE2E) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // Debug routes
  if (pathname.startsWith("/api/debug/")) {
    if (allowDebug) {
      return NextResponse.next();
    }
    return new Response(null, { status: 404 });
  }

  if (pathname.startsWith("/api/_dev/debug/")) {
    if (allowDebug) {
      return NextResponse.next();
    }
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