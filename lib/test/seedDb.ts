import { prisma } from "@/lib/prisma";

export async function seedDb() {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV !== "test") {
    throw new Error("seedDb can only run in test mode");
  }

  const user = await prisma.user.create({
    data: {
      id: "e2e-user",
      email: "e2e-user@test.local",
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "E2E Test Project",
      userId: user.id,
    },
  });

  return { user, project };
}
