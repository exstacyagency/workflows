import { db } from "@/lib/db";
import crypto from "crypto";
import { env } from "@/lib/env";

/**
 * Test routes are allowed in:
 * - NODE_ENV === test (CI)
 * - MODE === beta (self-operator beta)
 */
export function isTestEnvAllowed(): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.MODE === "beta") return true;
  if (env.NODE_ENV === "development") return true;
  return false;
}

export async function createTestSession(userId: string) {
  const token = crypto.randomUUID();
  await db.testSession.create({
    data: {
      token,
      userId,
    },
  });
  return token;
}
