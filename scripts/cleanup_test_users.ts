import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_EMAILS = ["a@test.local", "b@test.local"];

function assertSafeRuntime() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run cleanup_test_users in production.");
  }
}

async function main() {
  assertSafeRuntime();
  for (const email of TEST_EMAILS) {
    const users = await prisma.user.findMany({ where: { email: { mode: "insensitive", equals: email } } });
    for (const user of users) {
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Deleted user ${user.id} with email '${user.email}'`);
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
