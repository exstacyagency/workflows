// middleware.ts
import { cfg } from "@/lib/config";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return res;
}

const authMiddleware = withAuth(
  function middleware() {
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export default async function combinedMiddleware(req: NextRequest, event: NextFetchEvent) {
  const isProd = cfg.raw("NODE_ENV") === "production";
  const pathname = req.nextUrl.pathname;

  // Test-only debug routes must bypass NextAuth middleware; otherwise withAuth redirects before handler executes.
  if (!isProd && pathname.startsWith("/api/debug/")) {
    const res = applySecurityHeaders(NextResponse.next());
    return res;
  }

  if (isProd && pathname.startsWith("/api/debug")) {
    return new Response(null, { status: 404 });
  }

  const requestId = (
    req.headers.get("x-request-id") ||
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
  ).toString();

  const res = (await authMiddleware(req as any, event)) as any;
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/customer-profile/:path*",
    "/studio/:path*",
    "/api/projects/:path*",
    "/api/media/:path*",
    "/api/debug/:path*",
  ],
};
