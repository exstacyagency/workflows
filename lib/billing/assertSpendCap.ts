import { prisma } from "@/lib/prisma";
import { getCurrentPeriodKey } from "@/lib/billing/usage";

export class SpendCapExceededError extends Error {
  constructor(
    public readonly spentCents: number,
    public readonly capCents: number,
    public readonly periodKey: string,
  ) {
    super(
      `Monthly spend cap of $${(capCents / 100).toFixed(2)} exceeded. ` +
        `Current period spend: $${(spentCents / 100).toFixed(2)}.`,
    );
    this.name = "SpendCapExceededError";
  }
}

/**
 * Reads month-to-date actual spend from UsageEvent (settled costs only)
 * plus any reserved quota estimate for in-flight jobs.
 *
 * Throws SpendCapExceededError if over cap.
 * Does nothing if no cap is set (capCents <= 0).
 */
export async function assertUnderSpendCap(
  userId: string,
  projectId: string,
  estimatedJobCostCents = 0,
): Promise<{ spentCents: number; capCents: number; remainingCents: number }> {
  const periodKey = getCurrentPeriodKey();
  const period = new Date(
    Date.UTC(
      Number(periodKey.slice(0, 4)),
      Number(periodKey.slice(5, 7)) - 1,
      1,
    ),
  );

  // Account is linked through User.accountId, not Account.userId.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      account: {
        select: { spendCap: true },
      },
    },
  });

  const capCents = Math.trunc(Number(user?.account?.spendCap ?? 0));
  if (capCents <= 0) {
    return { spentCents: 0, capCents: 0, remainingCents: Infinity };
  }

  const aggregate = await prisma.usageEvent.aggregate({
    where: { userId, period },
    _sum: { costCents: true },
  });
  const settledCents = Math.trunc(Number(aggregate._sum.costCents ?? 0));

  const inFlightJobs = await prisma.job.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    select: { actualCost: true, estimatedCost: true },
  });
  const inFlightCents = inFlightJobs.reduce(
    (sum, job) =>
      sum +
      Math.max(
        Math.trunc(Number(job.actualCost ?? 0)),
        Math.trunc(Number(job.estimatedCost ?? 0)),
      ),
    0,
  );

  const totalCents = settledCents + inFlightCents + Math.max(0, Math.trunc(estimatedJobCostCents));

  if (totalCents > capCents) {
    throw new SpendCapExceededError(totalCents, capCents, periodKey);
  }

  return {
    spentCents: totalCents,
    capCents,
    remainingCents: capCents - totalCents,
  };
}
