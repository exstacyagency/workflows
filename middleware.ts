import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { withAuth } from "next-auth/middleware";

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

  // HARD BYPASSES — must stay first
  if (
    pathname === "/api/health" ||
    pathname === "/api/e2e/reset" ||
    pathname.startsWith("/api/_e2e/")
  ) {
    return NextResponse.next();
  }

  // Debug routes
  if (
    pathname.startsWith("/api/debug/") &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/api/debug/") &&
    process.env.NODE_ENV === "production"
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