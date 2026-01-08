import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function to2(n) {
  return String(n).padStart(2, "0");
}

function getCurrentPeriodKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${to2(now.getUTCMonth() + 1)}`;
}

function periodKeyToUtcDate(periodKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new Error(`Invalid periodKey: ${periodKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid periodKey: ${periodKey}`);
  }
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

async function main() {
  // Upsert by name (name is unique in your schema)
  await prisma.$executeRaw`DELETE FROM "AuthThrottle"`;

  const password = "TestPassword123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const userId = "test_user";
  const email = "test@local.dev";
  const name = "Test User";
  const attackerUserId = "attacker_user";
  const attackerEmail = "attacker@local.dev";
  const projectId = "proj_test";

  const now = new Date();
  const currentPeriodEnd = addDays(now, 30);

  await prisma.user.upsert({
    where: { id: userId },
    update: {
      email,
      name,
      passwordHash,
    },
    create: {
      id: userId,
      email,
      name,
      passwordHash,
    },
  });

  await prisma.user.upsert({
    where: { id: attackerUserId },
    update: {
      email: attackerEmail,
      name: "Attacker User",
      passwordHash,
    },
    create: {
      id: attackerUserId,
      email: attackerEmail,
      name: "Attacker User",
      passwordHash,
    },
  });

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: "GROWTH",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd,
      stripeCustomerId: `seed_cus_${userId}`,
      stripeSubscriptionId: `seed_sub_${userId}`,
      stripePriceId: "seed_price_growth",
    },
    create: {
      id: "sub_test",
      userId,
      planId: "GROWTH",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd,
      stripeCustomerId: `seed_cus_${userId}`,
      stripeSubscriptionId: `seed_sub_${userId}`,
      stripePriceId: "seed_price_growth",
    },
  });

  await prisma.subscription.upsert({
    where: { userId: attackerUserId },
    update: {
      planId: "GROWTH",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd,
      stripeCustomerId: `seed_cus_${attackerUserId}`,
      stripeSubscriptionId: `seed_sub_${attackerUserId}`,
      stripePriceId: "seed_price_growth",
    },
    create: {
      id: "sub_attacker",
      userId: attackerUserId,
      planId: "GROWTH",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd,
      stripeCustomerId: `seed_cus_${attackerUserId}`,
      stripeSubscriptionId: `seed_sub_${attackerUserId}`,
      stripePriceId: "seed_price_growth",
    },
  });

  await prisma.project.upsert({
    where: { id: projectId },
    update: {
      userId,
      name: "Test Project",
    },
    create: {
      id: projectId,
      userId,
      name: "Test Project",
    },
  });

  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);
  await prisma.usage.upsert({
    where: { userId_period: { userId, period } },
    update: { jobsUsed: 0, videoJobsUsed: 0, tokensUsed: 0 },
    create: { userId, period, jobsUsed: 0, videoJobsUsed: 0, tokensUsed: 0 },
  });

  console.log(JSON.stringify({ userId, email, projectId }));
}

main()
  .catch((e) => {
    console.error("CI seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
