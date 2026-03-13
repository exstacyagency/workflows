import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run rls-test in production.");
  }
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error("No user found to attach RLS test project to.");
  }
  const project = await prisma.project.create({
    data: { name: 'RLS Test Project', userId: user.id },
  });

  console.log(project);
  await prisma.$disconnect();
};

run();
