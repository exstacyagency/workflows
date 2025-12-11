// middleware.ts
import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-XSS-Protection", "0");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  // CSP tuned for dev; you can tighten this for production later
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https:",
      "font-src 'self' data: https:",
      "frame-ancestors 'none'",
    ].join("; ")
  );

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

export default function combinedMiddleware(req: Request) {
  // Run auth + security headers for all matched routes
  // withAuth will set NextResponse and we apply headers in the handler above.
  // This wrapper exists to keep a single default export.
  // @ts-expect-error - authMiddleware expects NextRequest, but Request is compatible at runtime.
  return authMiddleware(req);
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/customer-profile/:path*",
    "/api/projects/:path*",
    "/api/jobs/:path*",
  ],
};
