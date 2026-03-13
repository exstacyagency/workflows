// lib/auth/testSession.ts
import { db } from "@/lib/db";
import crypto from "crypto";
import { env } from "@/lib/env";
/**
 * Test routes are allowed in:
 * - NODE_ENV === test (CI)
 * - NODE_ENV === development (local only)
 */
export function isTestEnvAllowed(): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.NODE_ENV === "development") return true;
  return false;
}
export async function createTestSession(userId: string) {
  const token = crypto.randomUUID();
  await db.testSession.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    },
  });
  return token;
}
