import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.account.create({
    data: { tier: 'GROWTH', spendCap: 10000 },
  });

  await prisma.user.create({
    data: {
      email: 'paid@test.com',
      accountId: account.id,
    },
  });

  console.log('PAID account:', account.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
