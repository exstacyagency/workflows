// auth.ts
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  checkAuthAllowedDb,
  recordLoginFailureDb,
  recordLoginSuccessDb,
} from "@/lib/authAbuseGuardDb";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
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

        const email = credentials.email;
        const ip =
          (req as any)?.headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() ??
          (req as any)?.headers?.["x-forwarded-for"]?.split?.(",")?.[0]?.trim?.() ??
          null;

        const gate = await checkAuthAllowedDb({ kind: "login", ip, email });
        if (!gate.allowed) {
          throw new Error("Too many attempts. Try again later.");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.passwordHash) {
          await recordLoginFailureDb({ ip, email });
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          await recordLoginFailureDb({ ip, email });
          return null;
        }

        await recordLoginSuccessDb({ ip, email });

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
};

export const getAuthSession = () => getServerSession(authOptions);
