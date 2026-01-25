import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_EMAILS = ["a@test.local", "b@test.local"];

async function main() {
  for (const email of TEST_EMAILS) {
    const users = await prisma.user.findMany({ where: { email: { mode: "insensitive", equals: email } } });
    if (users.length === 0) {
      console.log(`No users found for email '${email}'`);
    } else {
      for (const user of users) {
        console.log(`Found user ${user.id} with email '${user.email}'`);
      }
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
