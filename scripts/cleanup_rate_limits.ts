import prisma from '../lib/prisma';

async function main() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const res = await prisma.rateLimitBucket.deleteMany({
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
