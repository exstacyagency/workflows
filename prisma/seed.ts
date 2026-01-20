import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@example.com";

  // 1. Ensure user exists
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Admin",
      passwordHash: await bcrypt.hash("admin123", 10),
    },
  });

  // 2. Ensure project exists for THAT user
  await prisma.project.upsert({
    where: { id: "proj_test" },
    update: {},
    create: {
      id: "proj_test",
      name: "Security Sweep Project",
      userId: user.id,
    },
  });

  console.log("Seed complete for:", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
