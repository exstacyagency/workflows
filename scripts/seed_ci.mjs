import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Upsert by name (name is unique in your schema)
  await prisma.plan.upsert({
    where: { name: "Growth" },
    update: {
      description: "Base plan",
      maxJobsPerDay: 20,
      maxVideoJobsPerDay: 5,
      maxMonthlyUsage: 50000,
    },
    create: {
      name: "Growth",
      description: "Base plan",
      maxJobsPerDay: 20,
      maxVideoJobsPerDay: 5,
      maxMonthlyUsage: 50000,
    },
  });

  await prisma.plan.upsert({
    where: { name: "Scale" },
    update: {
      description: "Pro plan",
      maxJobsPerDay: 200,
      maxVideoJobsPerDay: 50,
      maxMonthlyUsage: 1000000,
    },
    create: {
      name: "Scale",
      description: "Pro plan",
      maxJobsPerDay: 200,
      maxVideoJobsPerDay: 50,
      maxMonthlyUsage: 1000000,
    },
  });

  console.log("CI seed complete: Growth + Scale");
}

main()
  .catch((e) => {
    console.error("CI seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

