import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BETA_EMAIL;
  const cap = Number(process.env.CAP_CENTS ?? 0);

  if (!email) throw new Error("Set BETA_EMAIL env var");
  if (!Number.isFinite(cap) || cap < 0) throw new Error("Set CAP_CENTS to a non-negative integer");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, accountId: true },
  });
  if (!user) throw new Error(`User not found: ${email}`);
  if (!user.accountId) throw new Error(`User ${email} has no accountId`);

  const updated = await prisma.account.update({
    where: { id: user.accountId },
    data: { spendCap: Math.trunc(cap) },
    select: { id: true, spendCap: true },
  });

  console.log(
    `Account ${updated.id} spendCap set to ${updated.spendCap} cents` +
      ` ($${(updated.spendCap / 100).toFixed(2)})`,
  );
}

main()
  .catch((e: any) => {
    console.error(e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
