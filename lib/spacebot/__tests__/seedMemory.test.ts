const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "" });

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: jest.fn() },
    spacebotAuditLog: { create: jest.fn() },
  },
}));

jest.mock("child_process", () => ({ exec: jest.fn() }));
jest.mock("util", () => ({ promisify: () => execMock }));

import { mergeFacts } from "@/app/api/spacebot/memory/append/route";

describe("mergeFacts", () => {
  const baseDoc = `# Project Memory — Acme
Agent: creative
Seeded: 2025-01-01T00:00:00.000Z

## Brand Voice
Not yet defined.

## Approved Creative Decisions
Not yet defined.

## Cost Confirmation Preferences
Confirm any video generation job estimated over $10 before starting.

## Campaign Goals
Not yet defined.`;

  test("updates an existing section in-place", () => {
    const result = mergeFacts(baseDoc, {
      brand_voice: "Energetic, youth-focused, no corporate language",
    });
    expect(result).toContain("## Brand Voice\nEnergetic, youth-focused, no corporate language");
    expect(result).toContain("## Campaign Goals\nNot yet defined.");
    expect(result).toContain(
      "## Cost Confirmation Preferences\nConfirm any video generation job estimated over $10 before starting."
    );
  });

  test("appends a new section when key is not in existing doc", () => {
    const result = mergeFacts(baseDoc, {
      launch_date: "Summer 2025",
    });
    expect(result).toContain("## Launch Date\nSummer 2025");
    expect(result).toContain("## Brand Voice");
  });

  test("updates multiple keys in one call", () => {
    const result = mergeFacts(baseDoc, {
      brand_voice: "Bold and direct",
      campaign_goals: "Drive app installs",
    });
    expect(result).toContain("## Brand Voice\nBold and direct");
    expect(result).toContain("## Campaign Goals\nDrive app installs");
    expect(result).toContain("## Approved Creative Decisions\nNot yet defined.");
  });

  test("overwrites a section that was previously populated", () => {
    const updated = mergeFacts(baseDoc, {
      cost_confirmation_preferences: "Always confirm jobs over $5",
    });
    expect(updated).toContain(
      "## Cost Confirmation Preferences\nAlways confirm jobs over $5"
    );
    expect(updated).not.toContain("over $10");
  });

  test("handles empty existing doc gracefully", () => {
    const result = mergeFacts("", { brand_voice: "Minimal and clean" });
    expect(result).toContain("## Brand Voice\nMinimal and clean");
  });

  test("does not duplicate sections on repeated calls", () => {
    const first = mergeFacts(baseDoc, { brand_voice: "Bold" });
    const second = mergeFacts(first, { brand_voice: "Bold and direct" });
    const matches = (second.match(/## Brand Voice/g) ?? []).length;
    expect(matches).toBe(1);
  });

  test("trims whitespace from incoming values", () => {
    const result = mergeFacts(baseDoc, {
      brand_voice: "   Trim me   ",
    });
    expect(result).toContain("## Brand Voice\nTrim me");
    expect(result).not.toContain("   Trim me   ");
  });
});

jest.mock("fs", () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

import { seedProjectMemory } from "../seedMemory";

describe("seedProjectMemory", () => {
  beforeEach(() => {
    execMock.mockClear();
    const { promises: fsMock } = require("fs");
    (fsMock.writeFile as jest.Mock).mockClear();
    (fsMock.unlink as jest.Mock).mockClear();
  });

  test("seeds all four agents on project creation", async () => {
    await seedProjectMemory("proj_001", "Acme Campaign", "usr_alice");

    const copies = execMock.mock.calls.filter((c: string[][]) =>
      c[0].includes("docker cp")
    );
    expect(copies).toHaveLength(4);
  });

  test("seeds creative agent with cost_confirmation_preferences", async () => {
    await seedProjectMemory("proj_001", "Acme Campaign", "usr_alice");

    const { promises: fsMock } = require("fs");
    const writeCall = (fsMock.writeFile as jest.Mock).mock.calls.find(
      (c: string[]) => c[0].includes("creative")
    );
    expect(writeCall).toBeDefined();
    const content: string = writeCall[1];
    expect(content).toContain("Cost Confirmation Preferences");
    expect(content).toContain("$10");
  });

  test("seeds research agent even though all defaults are empty", async () => {
    await seedProjectMemory("proj_001", "Acme Campaign", "usr_alice");

    const { promises: fsMock } = require("fs");
    const researchWrite = (fsMock.writeFile as jest.Mock).mock.calls.find(
      (c: string[]) => c[0].includes("research")
    );
    expect(researchWrite).toBeDefined();
    const content: string = researchWrite[1];
    expect(content).toContain("# Project Memory — Acme Campaign");
    expect(content).toContain("Agent: research");
    expect(content).toContain("Not yet defined.");
  });

  test("overrides are merged on top of defaults", async () => {
    await seedProjectMemory("proj_001", "Acme", "usr_alice", {
      creative: { brand_voice: "Bold and energetic" },
    });

    const { promises: fsMock } = require("fs");
    const creativeWrite = (fsMock.writeFile as jest.Mock).mock.calls.find(
      (c: string[]) => c[0].includes("creative")
    );
    const content: string = creativeWrite[1];
    expect(content).toContain("Bold and energetic");
    expect(content).toContain("$10");
  });
});
