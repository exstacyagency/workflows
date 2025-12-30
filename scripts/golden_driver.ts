import fs from "node:fs";
import path from "node:path";

type GoldenInput = {
  version: number;
  projectId: string;
  users: { email: string; password: string }[];
  customerResearch?: {
    productName: string;
    productProblemSolved: string;
    productAmazonAsin: string;
    competitor1AmazonAsin?: string | null;
    competitor2AmazonAsin?: string | null;
  };
  scriptGeneration?: { projectId: string };
};

type CookieJar = Map<string, string>;

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function parseSetCookie(header: string): { name: string; value: string } | null {
  const m = header.match(/^([^=]+)=([^;]*)/);
  if (!m) return null;
  return { name: m[1], value: m[2] };
}

function jarHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function http(
  base: string,
  jar: CookieJar,
  method: string,
  url: string,
  opts?: { headers?: Record<string, string>; body?: string },
) {
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  const cookie = jarHeader(jar);
  if (cookie) headers["cookie"] = cookie;

  const res = await fetch(base + url, {
    method,
    headers,
    body: opts?.body,
    redirect: "manual",
  });

  const headersAny = res.headers as { getSetCookie?: () => string[] };
  const setCookies = headersAny.getSetCookie ? headersAny.getSetCookie() : [];
  if (!setCookies.length) {
    const singleSetCookie = res.headers.get("set-cookie");
    if (singleSetCookie) setCookies.push(singleSetCookie);
  }
  for (const sc of setCookies) {
    const kv = parseSetCookie(sc);
    if (kv) jar.set(kv.name, kv.value);
  }

  const text = await res.text();
  return { res, text };
}

async function getCsrf(base: string, jar: CookieJar): Promise<string> {
  const { res, text } = await http(base, jar, "GET", "/api/auth/csrf", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`csrf failed: ${res.status} ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  if (!j.csrfToken) throw new Error("csrfToken missing");
  return String(j.csrfToken);
}

async function login(base: string, email: string, password: string): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const csrf = await getCsrf(base, jar);

  const body = new URLSearchParams();
  body.set("csrfToken", csrf);
  body.set("email", email);
  body.set("password", password);
  body.set("json", "true");
  body.set("callbackUrl", `${base}/studio`);

  const { res, text } = await http(base, jar, "POST", "/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  // NextAuth returns 200 with json or 302. Accept either.
  if (!(res.status === 200 || res.status === 302)) {
    throw new Error(`login failed: ${res.status} ${text.slice(0, 200)}`);
  }

  // sanity: whoami should be 200
  const who = await http(base, jar, "GET", "/api/debug/whoami");
  if (!who.res.ok) throw new Error(`whoami failed: ${who.res.status} ${who.text.slice(0, 200)}`);

  return jar;
}

async function postJson(base: string, jar: CookieJar, url: string, payload: any) {
  const { res, text } = await http(base, jar, "POST", url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text };
}

async function getJson(base: string, jar: CookieJar, url: string) {
  const { res, text } = await http(base, jar, "GET", url, {
    headers: { accept: "application/json" },
  });
  return { status: res.status, text };
}

async function pollJob(base: string, jar: CookieJar, jobId: string, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { status, text } = await getJson(base, jar, `/api/jobs/${jobId}`);
    if (status !== 200) throw new Error(`job read failed: ${status} ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    const job = j.job ?? j;
    const s = String(job.status ?? "");
    if (s !== "PENDING" && s !== "RUNNING") return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting job ${jobId}`);
}

async function main() {
  const base = process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000";
  const inputPath = process.argv.includes("--input")
    ? process.argv[process.argv.indexOf("--input") + 1]
    : "e2e/golden/input.json";

  const input = readJson<GoldenInput>(path.resolve(inputPath));
  const user = input.users?.[0];
  if (!user?.email || !user?.password) throw new Error("golden input missing users[0]");

  const jar = await login(base, user.email, user.password);

  // Trigger CUSTOMER_RESEARCH (in SECURITY_SWEEP mode this should complete deterministically)
  if (input.customerResearch) {
    const cr = input.customerResearch;
    // IMPORTANT: API schema expects optional fields to be omitted, not null.
    const payload: any = {
      projectId: input.projectId,
      productName: cr.productName,
      productProblemSolved: cr.productProblemSolved,
      productAmazonAsin: cr.productAmazonAsin,
    };
    if (typeof cr.competitor1AmazonAsin === "string" && cr.competitor1AmazonAsin.trim().length > 0) {
      payload.competitor1AmazonAsin = cr.competitor1AmazonAsin.trim();
    }
    if (typeof cr.competitor2AmazonAsin === "string" && cr.competitor2AmazonAsin.trim().length > 0) {
      payload.competitor2AmazonAsin = cr.competitor2AmazonAsin.trim();
    }
    const { status, text } = await postJson(base, jar, "/api/jobs/customer-research", payload);
    if (status !== 200) throw new Error(`customer-research trigger failed: ${status} ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    if (j.jobId) await pollJob(base, jar, String(j.jobId));
  }

  // Trigger SCRIPT_GENERATION (in SECURITY_SWEEP mode this should complete deterministically)
  if (input.scriptGeneration) {
    const payload = { projectId: input.scriptGeneration.projectId };
    const { status, text } = await postJson(base, jar, "/api/jobs/script-generation", payload);
    if (status !== 200) throw new Error(`script-generation trigger failed: ${status} ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    if (j.jobId) await pollJob(base, jar, String(j.jobId));
  }

  // Pipeline status should be 200
  const ps = await getJson(base, jar, `/api/projects/${input.projectId}/pipeline-status?debug=1`);
  if (ps.status !== 200) throw new Error(`pipeline-status failed: ${ps.status} ${ps.text.slice(0, 200)}`);

  console.log("[golden] OK");
}

main().catch((e) => {
  console.error("[golden] driver failed:", e);
  process.exit(1);
});
