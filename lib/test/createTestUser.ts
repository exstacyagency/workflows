import { prisma } from "@/lib/db";
import { signTestToken } from "@/lib/test/signTestToken";

export async function createTestUser(email: string) {
  // Upsert user
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  // Upsert default project for the user
  const project = await prisma.project.upsert({
    where: {
      userId_name: {
        userId: user.id,
        name: "Test Project",
      },
    },
    update: {},
    create: {
      userId: user.id,
      name: "Test Project",
      description: "Default project for auth isolation test",
    },
  });

  return {
    token: signTestToken({ userId: user.id }),
    projectId: project.id,
  };
}
