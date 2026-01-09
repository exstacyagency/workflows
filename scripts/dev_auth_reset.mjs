import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const email = process.argv[2] || "attacker@local.dev";
const newPassword = process.argv[3] || "Attacker123";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run in production");
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`User not found: ${email}`);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  // Clear lockouts/throttle to prevent dev sign-in loops.
  // Your schema has authThrottle; if it changes, update this script accordingly.
  const cleared = await prisma.authThrottle.deleteMany({}).catch(() => ({ count: 0 }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        email: user.email,
        password: newPassword,
        authThrottleCleared: cleared.count ?? 0,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(String(e?.stack || e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
