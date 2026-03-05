import { notifyAll, JobCompletionPayload } from "../notifyAll";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        user: { id: "usr_alice" },
      }),
    },
  },
}));

jest.mock("@/lib/config", () => ({
  cfg: { raw: jest.fn().mockReturnValue("http://localhost:19898") },
}));

jest.mock("@/lib/notifications/ssePublisher", () => ({
  ssePublish: jest.fn().mockResolvedValue(undefined),
}));

const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
global.fetch = fetchMock as unknown as typeof fetch;

function makePayload(overrides: Partial<JobCompletionPayload> = {}): JobCompletionPayload {
  return {
    jobId: "job_001",
    jobType: "SCRIPT_GENERATION",
    projectId: "proj_acme",
    status: "COMPLETED",
    message: "Script done.",
    costCents: 800,
    ...overrides,
  };
}

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([u]: [string]) => u === url);
}

beforeEach(() => fetchMock.mockClear());

describe("notifyAll — team channel delivery (Phase 3)", () => {
  test("posts to 18789/webhook with conversation_id for a creative job", async () => {
    await notifyAll(makePayload({ jobType: "SCRIPT_GENERATION" }));

    const webhookCalls = callsTo("http://localhost:18789/webhook");
    expect(webhookCalls).toHaveLength(1);

    const body = JSON.parse(webhookCalls[0][1].body);
    expect(body.agent_id).toBe("creative");
    expect(body.conversation_id).toBe("discord:creative-campaigns");
    expect(body.job_id).toBe("job_001");
    expect(body.project_id).toBe("proj_acme");
    expect(body.cost_cents).toBe(800);
    expect(body.session_key).toBeUndefined();
  });

  test("posts to 18789/webhook with correct channel for a research job", async () => {
    await notifyAll(makePayload({ jobType: "CUSTOMER_RESEARCH" }));

    const body = JSON.parse(callsTo("http://localhost:18789/webhook")[0][1].body);
    expect(body.agent_id).toBe("research");
    expect(body.conversation_id).toBe("discord:research");
  });

  test("posts to 18789/webhook with correct channel for a support job", async () => {
    await notifyAll(makePayload({ jobType: "VIDEO_REVIEW" }));

    const body = JSON.parse(callsTo("http://localhost:18789/webhook")[0][1].body);
    expect(body.agent_id).toBe("support");
    expect(body.conversation_id).toBe("discord:support-tickets");
  });

  test("user session post goes to 19898 (not 18789)", async () => {
    await notifyAll(makePayload());

    const sessionCalls = callsTo("http://localhost:19898/hooks/agent");
    expect(sessionCalls.length).toBeGreaterThanOrEqual(1);

    const body = JSON.parse(sessionCalls[0][1].body);
    expect(body.session_key).toBe("creative:webchat-usr_alice:proj_acme");
    expect(body.conversation_id).toBeUndefined();
  });

  test("both delivery legs fire simultaneously (Promise.allSettled)", async () => {
    await notifyAll(makePayload());

    expect(callsTo("http://localhost:19898/hooks/agent")).toHaveLength(1);
    expect(callsTo("http://localhost:18789/webhook")).toHaveLength(1);
  });

  test("team channel failure does not throw or block user session delivery", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "http://localhost:18789/webhook") {
        return Promise.resolve({ ok: false, status: 502 });
      }
      return Promise.resolve({ ok: true, status: 200 });
    });

    await expect(notifyAll(makePayload())).resolves.not.toThrow();
    expect(callsTo("http://localhost:19898/hooks/agent")).toHaveLength(1);
  });

  test("VIDEO_REVIEW routes to support, not research", async () => {
    await notifyAll(makePayload({ jobType: "VIDEO_REVIEW" }));
    const body = JSON.parse(callsTo("http://localhost:18789/webhook")[0][1].body);
    expect(body.agent_id).toBe("support");
  });

  test("CHARACTER_VOICE_SETUP routes to support, not research", async () => {
    await notifyAll(makePayload({ jobType: "CHARACTER_VOICE_SETUP" }));
    const body = JSON.parse(callsTo("http://localhost:18789/webhook")[0][1].body);
    expect(body.agent_id).toBe("support");
  });
});
