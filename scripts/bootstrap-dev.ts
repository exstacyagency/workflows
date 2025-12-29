/**
 * Deterministic local bootstrap.
 * Safe to run repeatedly.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USERS = [
  { email: "test@local.dev", password: "Test1234!Test1234!" },
  { email: "attacker@local.dev", password: "Test1234!Test1234!" },
];

const PROJECT = {
  id: "proj_test",
  name: "Security Sweep Project",
};

async function main() {
  // --- users ---
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        passwordHash: hash,
      },
      update: {
        passwordHash: hash,
      },
    });
    console.log(`✔ user ${u.email}`);
  }

  const owner = await prisma.user.findUnique({
    where: { email: "test@local.dev" },
  });
  if (!owner) throw new Error("owner missing");

  // --- project ---
  await prisma.project.upsert({
    where: { id: PROJECT.id },
    create: {
      id: PROJECT.id,
      name: PROJECT.name,
      description: "Seeded by bootstrap-dev",
      userId: owner.id,
    },
    update: {},
  });
  console.log(`✔ project ${PROJECT.id}`);

  // --- wipe auth throttles (dev only) ---
  await prisma.authThrottle.deleteMany({});
  console.log("✔ authThrottle reset");

  console.log("Bootstrap complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
