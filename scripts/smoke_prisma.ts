import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.account.create({
    data: { tier: 'FREE', spendCap: 0 },
  });

  await prisma.user.create({
    data: {
      email: 'free@test.com',
      accountId: account.id,
    },
  });

  console.log('FREE account:', account.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
