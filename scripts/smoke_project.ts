import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.create({
    data: {
      name: "Smoke Test Project",
      accountId: "cmkbm9j3g0000ffcnlo1pumye"
    }
  });

  console.log("PROJECT_ID:", project.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
