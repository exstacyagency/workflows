// middleware.ts
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/projects/:path*",
    "/customer-profile/:path*",
    "/api/projects/:path*",
    "/api/jobs/:path*",
  ],
};
