import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/api/auth/signin" },
  callbacks: {
    authorized: ({ token, req }) => {
      // Bypass for test/dev/beta and /api/test/* or /api/projects
      const isTest =
        req.nextUrl.pathname.startsWith("/api/test/") ||
        req.nextUrl.pathname.startsWith("/api/projects");
      const mode =
        process.env.NODE_ENV !== "production" ||
        process.env.MODE === "beta" ||
        process.env.MODE === "test";
      if (mode && isTest) return true;
      return !!token;
    },
  },
});

export const config = {
  matcher: [
    "/projects/:path*",
    "/studio/:path*",
    "/api/jobs/:path*",
    "/api/projects/:path*",
    "/api/test/:path*",
  ],
};