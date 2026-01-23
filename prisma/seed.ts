import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {

  // 1. Ensure test user exists with email 'test@local.dev', prefer id 'user_test' if creating
  const testUserEmail = "test@local.dev";
  let testUser = await prisma.user.findUnique({ where: { email: testUserEmail } });
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        id: "user_test",
        email: testUserEmail,
        name: "Test User",
        passwordHash: await bcrypt.hash("test123", 10),
      },
    });
  }

  // 2. Ensure project exists for THAT user (idempotent upsert)
  await prisma.project.upsert({
    where: { id: "proj_test" },
    update: {},
    create: {
      id: "proj_test",
      name: "Test Project",
      userId: testUser.id, // MUST match seeded test user
    },
  });

  console.log("Seed complete for:", testUser.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
