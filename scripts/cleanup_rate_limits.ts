import prisma from '../lib/prisma';

function assertSafeRuntime() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run cleanup_rate_limits in production.");
  }
}

async function main() {
  assertSafeRuntime();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const res = await (prisma as any).rateLimitBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  console.log('Deleted old rate limit buckets:', res.count);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
