import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SMOKE_USER_EMAIL;
  if (!email) {
    throw new Error("SMOKE_USER_EMAIL env var is required");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`User not found for email ${email}`);
  }

  const project = await prisma.project.create({
    data: {
      name: "Smoke Test Project",
      user: { connect: { id: user.id } },
    },
  });

  console.log("PROJECT_ID:", project.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
