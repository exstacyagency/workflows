// auth.ts
import { cfg } from "@/lib/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  checkAuthAllowedDb,
  recordLoginFailureDb,
  recordLoginSuccessDb,
} from "@/lib/authAbuseGuardDb";
import { normalizeEmail } from "@/lib/normalizeEmail";

const isProd = process.env.NODE_ENV === "production";

export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || undefined,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = normalizeEmail(credentials.email);
        if (!email) return null;
        const ip =
          (req as any)?.headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() ??
          (req as any)?.headers?.["x-forwarded-for"]?.split?.(",")?.[0]?.trim?.() ??
          null;
        if (isProd) {
          try {
            const gate = await checkAuthAllowedDb({ kind: "login", ip, email });
            if (!gate.allowed) {
              return null;
            }
          } catch (e) {
            return null;
          }
        }
        const user = await prisma.user.findUnique({
          where: { email },
        });
        if (cfg.raw("AUTH_DEBUG") === "1") {
          console.log("[AUTH_DEBUG] email", email, "user?", !!user, "hasHash?", !!user?.passwordHash);
        }
        if (!user || !user.passwordHash) {
          if (isProd) {
            await recordLoginFailureDb({ ip, email });
          }
          return null;
        }
        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (cfg.raw("AUTH_DEBUG") === "1") {
          console.log("[AUTH_DEBUG] bcrypt compare", isValid);
        }
        if (!isValid) {
          if (isProd) {
            await recordLoginFailureDb({ ip, email });
          }
          return null;
        }
        if (isProd) {
          await recordLoginSuccessDb({ ip, email });
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user && "id" in user && (user as any).id) {
        token.id = (user as any).id as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as any).id = token.id as string;
      }
      return session;
    },
  },
  events: {
    async signIn() {
      if (!isProd && !(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)) {
        console.warn(
          "[auth] Missing AUTH_SECRET/NEXTAUTH_SECRET in dev. Sessions/CSRF can be flaky. Set a stable secret in .env.local."
        );
      }
    },
  },
};

export async function getAuthSession() {
  return getServerSession(authOptions);
}