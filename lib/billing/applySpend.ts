import { prisma } from "@/lib/prisma";

export async function applySpend(
  accountId: string,
  amount: number,
  sourceId: string,
) {
  if (amount <= 0) {
    throw new Error("Invalid spend amount");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.spendEvent.findUnique({
      where: { sourceId },
      select: { id: true },
    });

    if (existing) {
      return { applied: false };
    }

    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { spend: true, spendCap: true },
    });

    if (!account) {
      throw new Error("Account not found");
    }

    const nextSpend = account.spend + amount;
    if (account.spendCap > 0 && nextSpend > account.spendCap) {
      throw new Error("SPEND_CAP_EXCEEDED");
    }

    await tx.spendEvent.create({
      data: {
        accountId,
        amount,
        sourceId,
      },
    });

    await tx.account.update({
      where: { id: accountId },
      data: { spend: nextSpend },
    });

    return { applied: true };
  });
}
