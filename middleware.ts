import { withAuth } from "next-auth/middleware";
import { cfg } from "@/lib/config";

export default withAuth({
  pages: {
    signIn: "/api/auth/signin",
  },
  callbacks: {
    authorized: ({ token }) => {
      // All matched routes require auth
      return !!token;
    },
  },
});

// Explicitly scope auth to only the following routes
export const config = {
  matcher: [
    "/projects/:path*",
    "/studio/:path*",
    "/api/jobs/:path*",
    "/api/projects/:path*",
  ],
};