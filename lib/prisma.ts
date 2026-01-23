// lib/prisma.ts
import { cfg } from "@/lib/config";
import { PrismaClient } from '@prisma/client';

// This prevents Prisma from creating too many connections in dev
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

if (cfg().raw("NODE_ENV") !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
