import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find all (userId, name) pairs with duplicates
  const duplicates = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "userId", name, COUNT(*)
    FROM "project"
    GROUP BY "userId", name
    HAVING COUNT(*) > 1
  `);

  for (const { userId, name } of duplicates) {
    // Get all projects for this userId/name, order by createdAt
    const projects = await prisma.project.findMany({
      where: { userId, name },
      orderBy: { createdAt: "asc" },
    });
    // Keep the first, rename the rest
    for (let i = 1; i < projects.length; i++) {
      const project = projects[i];
      await prisma.project.update({
        where: { id: project.id },
        data: { name: `${name} (dupe ${i})` },
      });
      console.log(`Renamed project ${project.id} to '${name} (dupe ${i})'`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
