import { POST } from "@/app/api/campaigns/route";
import { prisma } from "@/lib/prisma";

const API_URL = "http://localhost/api/campaigns";

describe("FREE tier campaign API enforcement", () => {
  let accountId: string;

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        tier: "FREE",
        spendCap: 0,
      },
    });
    accountId = account.id;
  });

  afterEach(async () => {
    await prisma.campaign.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  it("allows only one campaign", async () => {
    const firstRequest = new Request(API_URL, {
      method: "POST",
      body: JSON.stringify({ accountId, name: "First" }),
      headers: { "content-type": "application/json" },
    });

    const firstResponse = await POST(firstRequest);
    expect(firstResponse.status).toBe(201);

    const secondRequest = new Request(API_URL, {
      method: "POST",
      body: JSON.stringify({ accountId, name: "Second" }),
      headers: { "content-type": "application/json" },
    });

    const secondResponse = await POST(secondRequest);
    const body = await secondResponse.json();

    expect(secondResponse.status).toBe(403);
    expect(body.error).toBe("FREE tier limited to 1 campaign");

    const count = await prisma.campaign.count({ where: { accountId } });
    expect(count).toBe(1);
  });
});
