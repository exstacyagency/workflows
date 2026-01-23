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
    // Cleanup: delete any existing user with email 'test@local.dev' to guarantee deterministic id
    await prisma.user.deleteMany({ where: { email: "test@local.dev" } });
  // --- users ---
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.email === "test@local.dev" ? "user_test" : undefined,
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
  if ((prisma as any).authThrottle) {
    await (prisma as any).authThrottle.deleteMany({});
    console.log("✔ authThrottle reset");
  }

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
