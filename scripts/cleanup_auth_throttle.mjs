/* eslint-disable no-restricted-properties */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_ROWS = Number(process.env.AUTH_THROTTLE_CLEANUP_MAX ?? 5000);
const GRACE_MS = Number(process.env.AUTH_THROTTLE_GRACE_MS ?? 60 * 60_000); // 1h

function msAgo(ms) {
  return new Date(Date.now() - ms);
}

async function main() {
  // Delete rows that are not locked and whose reset window is long past.
  // Also delete rows whose lockout expired long ago.
  const cutoff = msAgo(GRACE_MS);

  const del = await prisma.authThrottle.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { lockedUntil: null, resetAt: { lt: cutoff } },
            { lockedUntil: { lt: cutoff } },
          ],
        },
      ],
    },
  });

  // Optional: if table is still huge, cap by deleting oldest updatedAt rows.
  const remaining = await prisma.authThrottle.count();
  if (remaining > MAX_ROWS) {
    const toDelete = remaining - MAX_ROWS;
    const oldest = await prisma.authThrottle.findMany({
      orderBy: { updatedAt: "asc" },
      take: Math.min(toDelete, 20000),
      select: { id: true },
    });
    if (oldest.length > 0) {
      await prisma.authThrottle.deleteMany({
        where: { id: { in: oldest.map((x) => x.id) } },
      });
    }
  }

  const after = await prisma.authThrottle.count();
  console.log(`AuthThrottle cleanup: deleted=${del.count} remaining=${after}`);
}

main()
  .catch((e) => {
    console.error("AuthThrottle cleanup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

