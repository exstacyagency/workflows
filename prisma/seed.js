import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run prisma/seed.js in production.');
  }
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
    },
  });

  await prisma.project.create({
    data: {
      name: 'Test Project',
      userId: user.id,
    },
  });

  console.log('Seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
