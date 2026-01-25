
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";
import { cfg } from "@/lib/config";
import { NextRequest } from "next/server";

// Accepts optional NextRequest for header access (for test tokens)
export async function getSessionUserId(req?: NextRequest): Promise<string | null> {
  // Allow test tokens only in beta/test mode
  if (
    cfg.nodeEnv === "production" &&
    (cfg.mode === "beta" || cfg.mode === "test") &&
    req
  ) {
    // Check for Authorization: Bearer <token>
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, cfg.authTestSecret || "") as { userId?: string };
        if (payload && payload.userId) {
          return payload.userId;
        }
      } catch (err) {
        // Invalid token, ignore and fallback
      }
    }
  }

  // Fallback: NextAuth session
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (userId) {
    return userId;
  }

  // Fallback: resolve by email if id missing
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  return null;
}

