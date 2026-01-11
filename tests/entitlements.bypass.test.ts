import { POST as createCampaign } from "@/app/api/campaigns/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const testEmail = `free+${Date.now()}@test.com`;

describe("Entitlement gate – bypass prevention", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const account = await prisma.account.create({
      data: {
        tier: "FREE",
        spendCap: 0,
      },
    });
    accountId = account.id;

    const user = await prisma.user.create({
      data: {
        accountId,
        email: testEmail,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { accountId } });
    if (userId) {
      await prisma.usage.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  it("denies campaign creation for FREE tier and performs no mutation", async () => {
    const beforeCount = await prisma.campaign.count({
      where: { accountId },
    });

    const req = new NextRequest("http://localhost/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Illegal campaign",
      }),
      headers: {
        "content-type": "application/json",
        "x-test-user-id": userId,
      },
    });

    const res = await createCampaign(req);
    const body = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.allowed).toBe(false);

    const afterCount = await prisma.campaign.count({
      where: { accountId },
    });

    expect(afterCount).toBe(beforeCount);
  });
});
