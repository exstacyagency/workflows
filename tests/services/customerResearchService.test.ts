// customerResearchService.test.ts

const prismaMock = {
  researchRow: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  job: {
    update: jest.fn(),
  },
};

jest.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

const actorCallMock = jest.fn();

jest.mock("@/lib/apify", () => ({
  apifyClient: {
    actor: () => ({
      call: actorCallMock,
    }),
  },
}));

jest.mock("@/lib/jobs/updateJobStatus", () => ({
  updateJobStatus: jest.fn(async () => {}),
}));

import { runCustomerResearch } from "@/services/customerResearchService";

describe("customerResearchService", () => {
  beforeEach(() => {
    Object.assign(process.env, { NODE_ENV: "development" });
    jest.clearAllMocks();
  });

  it("sends amazon inputs in the correct shape (product + competitors)", async () => {
    actorCallMock.mockResolvedValue({
      items: [],
    });

    await runCustomerResearch({
      projectId: "proj-1",
      productAmazonAsin: "B0CG9QS1JY",
      competitor1AmazonAsin: "B0AAA111",
      competitor2AmazonAsin: "B0BBB222",
      productName: "",
      productProblemSolved: "",
      redditKeywords: [],
      scrapeComments: true,
      maxPosts: 50,
      maxCommentsPerPost: 50,
      timeRange: "month",
    } as any);

    expect(actorCallMock).toHaveBeenCalledTimes(1);

    const arg = actorCallMock.mock.calls[0][0];

    expect(arg).toEqual({
      input: {
        input: expect.arrayContaining([
          expect.objectContaining({ asin: "B0CG9QS1JY", filterByStar: "four_star" }),
          expect.objectContaining({ asin: "B0AAA111", filterByStar: "one_star" }),
          expect.objectContaining({ asin: "B0BBB222", filterByStar: "one_star" }),
        ]),
      },
    });

    const arr = (arg as any).input.input;
    expect(Array.isArray(arr)).toBe(true);
    arr.forEach((x: any) => {
      expect(x).toEqual(
        expect.objectContaining({
          domainCode: "com",
          sortBy: "recent",
          maxPages: 1,
          filterByKeyword: "",
          reviewerType: "all_reviews",
          formatType: "current_format",
          mediaType: "all_contents",
        })
      );
    });
  });
});
