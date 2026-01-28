// lib/auth/options.ts
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          console.log("[auth] authorize attempt for:", credentials?.email);
          
          if (!credentials?.email || !credentials?.password) {
            console.log("[auth] missing credentials");
            return null;
          }
          
          const user = await db.user.findUnique({
            where: { email: credentials.email }
          });
          
          console.log("[auth] user found:", !!user, "has password:", !!user?.passwordHash);
          
          if (!user?.passwordHash) {
            console.log("[auth] no user or no password hash");
            return null;
          }
          
          const valid = await bcrypt.compare(credentials.password, user.passwordHash);
          console.log("[auth] password valid:", valid);
          
          if (!valid) {
            console.log("[auth] invalid password");
            return null;
          }
          
          console.log("[auth] login success for user:", user.id);
          return {
            id: user.id,
            email: user.email,
            name: user.name || null,
          };
        } catch (error) {
          console.error("[auth] authorize error:", error);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: "test-session",
      name: "TestSession",
      credentials: {
        token: { label: "Test Session Token", type: "text" },
      },
      async authorize(credentials, req) {
        try {
          if (cfg.isDev || cfg.MODE === "beta" || cfg.MODE === "test") {
            let token = credentials?.token;
            if (!token && req.headers?.cookie) {
              const match = req.headers.cookie.match(/test_session=([^;]+)/);
              if (match) token = match[1];
            }
            if (token) {
              const testSession = await db.testSession.findUnique({ where: { token } });
              if (testSession) {
                return {
                  id: testSession.userId,
                  name: `TestUser-${testSession.userId}`,
                  email: `test-${testSession.userId}@local.dev`,
                  testSessionToken: token,
                  isTestUser: true,
                };
              }
            }
          }
          return null;
        } catch (error) {
          console.error("[auth] test session authorize error:", error);
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        if (token?.id) (session.user as any).id = token.id as string;
        if (token?.isTestUser) (session.user as any).isTestUser = true;
        if (token?.testSessionToken) (session.user as any).testSessionToken = token.testSessionToken;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      if ((user as any)?.isTestUser) token.isTestUser = true;
      if ((user as any)?.testSessionToken) token.testSessionToken = (user as any).testSessionToken;
      return token;
    },
  },
};