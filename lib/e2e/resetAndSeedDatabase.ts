import { prisma } from "@/lib/prisma";

export async function resetAndSeedDatabase() {
  // ⚠️ Order matters because of FK constraints
  await prisma.$transaction([
    prisma.job.deleteMany(),
    prisma.project.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // Optional: seed baseline data for E2E
  await prisma.user.create({
    data: {
      id: "e2e-user",
      email: "e2e@example.com",
      name: "E2E User",
    },
  });
}
