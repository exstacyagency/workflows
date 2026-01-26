
import { PrismaClient } from "@prisma/client";
import { cfg } from "@/lib/config";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}



export const prisma =
  global.prisma ??
  new PrismaClient({
    log: cfg.nodeEnv === "development" ? ["query", "error"] : ["error"],
  });

export const db = prisma;


if (cfg.nodeEnv !== "production") {
  global.prisma = prisma;
}
