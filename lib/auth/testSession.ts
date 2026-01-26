import { db } from "@/lib/db";
import crypto from "crypto";

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
