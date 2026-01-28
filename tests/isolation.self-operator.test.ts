// tests/isolation.self-operator.test.ts
import { startTestServer, stopTestServer } from "./utils/testServer";
import { clearTestData } from "@/lib/testStore";
import type { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const result = await startTestServer();
  server = result.server;
  baseUrl = `http://localhost:${result.port}`;
}, 60000);

afterAll(async () => {
  await clearTestData();
  await stopTestServer();
}, 10000);

async function createUser(): Promise<{ cookie: string }> {
  const res = await fetch(`${baseUrl}/api/test/create-user`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create-user failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  if (!body?.token) throw new Error("No test token");

  const testSessionCookie = `test_session=${body.token}`;

  const authRes = await fetch(`${baseUrl}/api/test/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: testSessionCookie,
    },
    body: `token=${encodeURIComponent(body.token)}`,
    redirect: "manual",
  });

  if (!authRes.ok) {
    const text = await authRes.text();
    throw new Error(`auth failed ${authRes.status}: ${text.slice(0, 300)}`);
  }

  const authSetCookie = authRes.headers.get("set-cookie");
  if (!authSetCookie) throw new Error("No auth cookie");

  return { cookie: `${testSessionCookie}; ${authSetCookie.split(";")[0]}` };
}

async function authedFetch(url: string, cookie: string, opts: any = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), cookie, "content-type": "application/json" },
  });
}

describe("Self-operator isolation", () => {
  test("User A cannot access User B's resources", async () => {
    const A = await createUser();
    const B = await createUser();

    const projectRes = await authedFetch(`${baseUrl}/api/projects`, B.cookie, {
      method: "POST",
      body: JSON.stringify({ name: "B Project" }),
    });
    
    expect(projectRes.ok).toBe(true);
    const project = await projectRes.json();

    const leak = await authedFetch(`${baseUrl}/api/projects/${project.id}`, A.cookie);
    expect([403, 404]).toContain(leak.status);

    const jobRes = await authedFetch(`${baseUrl}/api/jobs`, B.cookie, {
      method: "POST",
      body: JSON.stringify({ 
        projectId: project.id,
        pipeline: "CUSTOMER_RESEARCH",
        idempotencyKey: `test-${Date.now()}`
      }),
    });
    
    if (!jobRes.ok) {
      const errorText = await jobRes.text();
      console.error('Job creation failed:', {
        status: jobRes.status,
        body: errorText,
        cookie: B.cookie,
        projectId: project.id
      });
    }
    
    expect(jobRes.ok).toBe(true);
    const job = await jobRes.json();

    const jobLeak = await authedFetch(`${baseUrl}/api/jobs/${job.id}`, A.cookie);
    expect([403, 404]).toContain(jobLeak.status);

    const retry = await authedFetch(`${baseUrl}/api/jobs/${job.id}/retry`, A.cookie, {
      method: "POST",
    });
    expect([403, 404]).toContain(retry.status);
  }, 30000);
});