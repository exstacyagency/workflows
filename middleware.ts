// middleware.ts
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/api/auth/signin" },
  callbacks: {
    authorized: ({ token, req }) => {
      const { pathname } = req.nextUrl;
      
      // Allow test bootstrap in beta/test/dev
      if (pathname.startsWith("/api/test/")) {
        const mode =
          process.env.NODE_ENV !== "production" ||
          process.env.MODE === "beta" ||
          process.env.MODE === "test";
        return mode;
      }
      
      // Check for test session cookie in beta/test/dev
      const mode =
        process.env.NODE_ENV !== "production" ||
        process.env.MODE === "beta" ||
        process.env.MODE === "test";
      
      if (mode) {
        const testSession = req.cookies.get("test_session")?.value;
        if (testSession) return true;
      }
      
      // Default: require NextAuth token
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