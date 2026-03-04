import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";

export async function validateApiKey(req: Request): Promise<string | null> {
  const key = req.headers.get("x-api-key")?.trim();
  if (!key) return null;
  const keyHash = createHash("sha256").update(key).digest("hex");
  console.log("[validateApiKey] key prefix:", key.slice(0, 12), "hash:", keyHash.slice(0, 16));
  const found = await prisma.userApiKey.findFirst({
    where: { keyHash, revokedAt: null },
    select: { userId: true },
  });
  console.log("[validateApiKey] found:", found?.userId ?? "null");
  return found?.userId ?? null;
}
