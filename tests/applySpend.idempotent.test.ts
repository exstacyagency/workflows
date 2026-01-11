import { applySpend } from "@/lib/billing/applySpend";
import { prisma } from "@/lib/prisma";

describe("applySpend idempotency", () => {
  afterAll(async () => {
    await prisma.spendEvent.deleteMany();
    await prisma.account.deleteMany();
  });

  it("does not double charge for same sourceId", async () => {
    const account = await prisma.account.create({
      data: { tier: "GROWTH", spendCap: 1000 },
    });

    await applySpend(account.id, 100, "evt-1");
    await applySpend(account.id, 100, "evt-1");

    const updated = await prisma.account.findUnique({
      where: { id: account.id },
      select: { spend: true },
    });

    expect(updated?.spend).toBe(100);

    await prisma.spendEvent.deleteMany({ where: { accountId: account.id } });
    await prisma.account.delete({ where: { id: account.id } });
  });
});
