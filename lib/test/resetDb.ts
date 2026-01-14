import { prisma } from "@/lib/prisma";

export async function resetDb() {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetDb can only run in test mode");
  }

  // Order matters for FK constraints.
  await prisma.job.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}
