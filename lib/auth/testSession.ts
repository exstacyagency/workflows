import { db } from "@/lib/db";
import crypto from "crypto";
import { env } from "@/lib/env";

/**
 * Test routes are allowed in:
 * - NODE_ENV === test (CI)
 * - MODE === beta (self-operator beta)
 */
export function assertTestEnv() {
  if (env.NODE_ENV === "test") return;
  if (env.MODE === "beta") return;
    /**
     * Allowed execution contexts:
     * - node test runner (NODE_ENV=test)
     * - beta/prod boot (MODE=beta|prod)
     * - local dev server running tests (NODE_ENV=development)
     *
     * IMPORTANT:
     * Next.js API routes always run with NODE_ENV=development
     * under `next dev`, even when invoked by tests.
     */
    if (env.NODE_ENV === "development") return;
    throw new Error("Test routes are only available in test, beta, or dev mode");
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
