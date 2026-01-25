import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find all lowercased emails with duplicates
  const duplicates = await prisma.$queryRawUnsafe<any[]>(`
    SELECT LOWER(email) as lower_email, COUNT(*)
    FROM "user"
    GROUP BY lower_email
    HAVING COUNT(*) > 1
  `);

  for (const { lower_email } of duplicates) {
    // Get all users with this lowercased email, order by createdAt
    const users = await prisma.user.findMany({
      where: { email: { mode: "insensitive", equals: lower_email } },
      orderBy: { createdAt: "asc" },
    });
    // Keep the first, delete the rest
    for (let i = 1; i < users.length; i++) {
      const user = users[i];
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Deleted duplicate user ${user.id} with email '${user.email}'`);
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
