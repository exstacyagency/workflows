import { prisma } from '../lib/prisma';

async function main() {
  await prisma.plan.upsert({
    where: { name: 'Growth' },
    update: {},
    create: {
      name: 'Growth',
      description: 'Base plan',
      maxJobsPerDay: 20,
      maxVideoJobsPerDay: 5,
      maxMonthlyUsage: 50000,
    },
  });

  await prisma.plan.upsert({
    where: { name: 'Scale' },
    update: {},
    create: {
      name: 'Scale',
      description: 'Pro plan',
      maxJobsPerDay: 200,
      maxVideoJobsPerDay: 50,
      maxMonthlyUsage: 1000000,
    },
  });
}

main().finally(() => prisma.$disconnect());
