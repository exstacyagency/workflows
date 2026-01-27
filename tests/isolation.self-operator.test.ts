import assert from "assert";
import { test } from "node:test";

const base = "http://localhost:3000";

async function createUser() {
  const res = await fetch(`${base}/api/test/create-user`, {
    method: "POST",
  });
  const body = await res.json();
  const testSessionCookie = res.headers.get("set-cookie")?.match(/test_session=([^;]+)/)?.[0];
  assert(testSessionCookie, "No test_session cookie returned");
  // Authenticate with dedicated test Credentials provider in test/dev/beta
  const authRes = await fetch(`${base}/api/test/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cookie": testSessionCookie },
    body: `token=${encodeURIComponent(testSessionCookie.split('=')[1])}`,
    redirect: "manual",
  });
  const nextAuthSessionCookie = authRes.headers.get("set-cookie")?.split(';')[0];
  assert(nextAuthSessionCookie, "No session cookie returned from NextAuth");
  // Combine both cookies for subsequent requests
  const combinedCookie = `${testSessionCookie}; ${nextAuthSessionCookie}`;
  return { cookie: combinedCookie, userId: body.userId };
}

async function authedFetch(
  url: string,
  cookie: string,
  opts: any = {}
) {
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      cookie,
    },
  });
}

test("Self-operator isolation", async (t) => {
  const A = await createUser();
  const B = await createUser();

  // B creates project
  const projectRes = await authedFetch(
    `${base}/api/projects`,
    B.cookie,
    {
      method: "POST",
      body: JSON.stringify({ name: "B Project" }),
    }
  );
  const project = await projectRes.json();

  // A cannot see B project
  const leak = await authedFetch(
    `${base}/api/projects/${project.id}`,
    A.cookie
  );
  assert(leak.status === 404 || leak.status === 403);

  // B creates job
  const jobRes = await authedFetch(
    `${base}/api/jobs`,
    B.cookie,
    {
      method: "POST",
      body: JSON.stringify({ projectId: project.id }),
    }
  );
  const job = await jobRes.json();

  // A cannot read job
  const jobLeak = await authedFetch(
    `${base}/api/jobs/${job.id}`,
    A.cookie
  );
  assert(jobLeak.status === 404 || jobLeak.status === 403);

  // A cannot retry job
  const retry = await authedFetch(
    `${base}/api/jobs/${job.id}/retry`,
    A.cookie,
    { method: "POST" }
  );
  assert(retry.status === 404 || retry.status === 403);
});
