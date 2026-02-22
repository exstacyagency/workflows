/**
 * Runtime auth settings that must stay consistent between NextAuth handlers
 * and middleware token parsing.
 */
import { cfg } from "@/lib/config";

const useSecureCookies =
  (cfg.raw("NEXTAUTH_URL")?.startsWith("https://") ?? false) ||
  Boolean(cfg.raw("VERCEL"));

export const authSecret = cfg.raw("AUTH_SECRET") || cfg.raw("NEXTAUTH_SECRET");

export const sessionTokenCookieName = useSecureCookies
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

export const sessionTokenCookieSecure = useSecureCookies;
