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
    return applySecurityHeaders(NextResponse.next());
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export default async function combinedMiddleware(
  req: NextRequest,
  event: NextFetchEvent
) {
  const pathname = req.nextUrl.pathname;

  // 🔥 HARD BYPASS FOR E2E RESET
  if (pathname === "/api/e2e/reset") {
    return NextResponse.next();
  }

  // HARD bypass — must be first
  if (pathname.startsWith("/api/_e2e/")) {
    return NextResponse.next();
  }

  const isProd = cfg.raw("NODE_ENV") === "production";

  // Existing debug rules
  if (!isProd && pathname.startsWith("/api/debug/")) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (isProd && pathname.startsWith("/api/debug")) {
    return new Response(null, { status: 404 });
  }

  const requestId =
    req.headers.get("x-request-id") ??
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random()}`;

  const res = (await authMiddleware(req as any, event)) as NextResponse;
  res.headers.set("x-request-id", requestId.toString());
  return res;
}

export const config = {
  matcher: [
    "/((?!api/e2e/reset|_next|favicon.ico).*)"
  ]
};