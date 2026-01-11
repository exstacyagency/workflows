import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  const user = await prisma.user.findFirst();
  const project = await prisma.project.create({
    data: { name: 'RLS Test Project', userId: user.id },
  });

  console.log(project);
  await prisma.$disconnect();
};

run();