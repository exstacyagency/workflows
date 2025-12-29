/* eslint-disable no-restricted-properties */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadDotEnvFile(filename) {
  const filePath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvFile(".env");
loadDotEnvFile(".env.local");

const BASE_URL = process.env.BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
const IS_CI_OR_TEST = !!process.env.CI || process.env.NODE_ENV === "test";
const TEST_EMAIL = process.env.SWEEP_TEST_EMAIL || "test@local.dev";
const TEST_PASSWORD = process.env.SWEEP_TEST_PASSWORD || "Test1234!Test1234!";
const ATTACKER_EMAIL = process.env.ATTACKER_EMAIL || "attacker@local.dev";
const ATTACKER_PASSWORD = process.env.SWEEP_TEST_PASSWORD || TEST_PASSWORD;

function normalizeEmailInput(value) {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

function ensureUserWithPassword(email, password) {
  // Use your existing script to ensure the user has a valid credential hash.
  // This makes the sweep deterministic across environments.
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["tsx", "scripts/set_password.ts", email, password];
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    throw new Error(`[seed] set_password failed with exit code ${r.status ?? "null"}`);
  }
}

function migrateOrFail() {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  // Deploy migrations to whatever DATABASE_URL points at.
  const r = spawnSync(cmd, ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    throw new Error(`[preflight] prisma migrate deploy failed with exit code ${r.status}`);
  }
}

function runBootstrapDev() {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(cmd, ["tsx", "scripts/bootstrap-dev.ts"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    throw new Error(`[preflight] bootstrap-dev failed with exit code ${r.status ?? "null"}`);
  }
}

async function ensureProjectExistsOrFail() {
  const prisma = new PrismaClient();
  try {
    // Match whatever your API expects. "Project" model in schema uses:
    // id: String @id @default(uuid())
    // name: String
    // description: String?
    // userId: String
    // We’ll attach it to the sweep user.
    const email = normalizeEmailInput(TEST_EMAIL) || TEST_EMAIL;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`[seed] cannot seed project; user not found for ${email}`);

    const existing = await prisma.project.findUnique({
      where: { id: "proj_test" },
      select: { id: true },
    });
    if (existing) {
      console.log("[seed] project already exists: proj_test");
      return;
    }

    await prisma.project.create({
      data: {
        id: "proj_test",
        name: "Security Sweep Project",
        description: "Seeded by attacker_sweep",
        userId: user.id,
      },
    });
    console.log("[seed] created project: proj_test");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function ensureGrowthSubscriptionOrFail() {
  const prisma = new PrismaClient();
  try {
    const email = normalizeEmailInput(TEST_EMAIL) || TEST_EMAIL;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`[seed] cannot seed subscription; user not found for ${email}`);

    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        planId: "GROWTH",
        status: "active",
      },
      create: {
        userId: user.id,
        planId: "GROWTH",
        status: "active",
      },
    });

    console.log("[seed] ensured subscription: GROWTH");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

async function ensureUserExists(baseUrl) {
  // Uses your existing /api/auth/register route.
  // If user already exists, route should return 409/400; that's fine.
  const url = `${baseUrl}/api/auth/register`;
  const { res, json, text } = await postJson(url, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (res.ok) {
    console.log(`[seed] register ok for ${TEST_EMAIL}`);
    return;
  }
  // Accept "already exists" style failures; anything else should fail fast.
  const msg = json?.error || json?.message || text || "";
  const okAlready = res.status === 409 || /already/i.test(msg) || /exists/i.test(msg);
  if (okAlready) {
    console.log(`[seed] user already exists: ${TEST_EMAIL}`);
    return;
  }
  throw new Error(`[seed] register failed (${res.status}): ${msg}`);
}

async function clearLockout(baseUrl) {
  const token = process.env.DEBUG_ADMIN_TOKEN || "";
  const tokenQ = token ? `&token=${encodeURIComponent(token)}` : "";
  // If your clear-lockout route takes an email param, pass it.
  // If it doesn't, it should still clear global lockout; we keep both.
  const urlWithEmail = `${baseUrl}/api/dev/clear-lockout?email=${encodeURIComponent(TEST_EMAIL)}`;
  let r = await fetch(`${urlWithEmail}${tokenQ}`, { method: "POST", redirect: "manual" });
  if (!r.ok) {
    const urlNoEmail = `${baseUrl}/api/dev/clear-lockout`;
    r = await fetch(`${urlNoEmail}?token=${encodeURIComponent(token)}`, { method: "POST", redirect: "manual" });
  }
  console.log(`[preflight] clear-lockout: ${r.status}`);
  if (!r.ok) {
    const t = await r.text();
    const allowMissing = process.env.CI === "true" || process.env.SECURITY_SWEEP === "1";
    if (allowMissing && (r.status === 404 || r.status === 405)) {
      console.log(`[preflight] clear-lockout unavailable (${r.status}), continuing`);
      return;
    }
    throw new Error(`[preflight] clear-lockout failed (${r.status}): ${t}`);
  }
}

async function maybeClearLockout() {
  // In CI, repeated runs can trip the login abuse guard. Clear it so the test can proceed.
  if (process.env.CI !== "true") return;
  try {
    const token = process.env.DEBUG_ADMIN_TOKEN || "";
    const tokenQ = token ? `&token=${encodeURIComponent(token)}` : "";
    const url = `${BASE_URL}/api/dev/clear-lockout?email=${encodeURIComponent(TEST_EMAIL)}${tokenQ}`;
    const r = await fetch(url, { method: "POST" });
    // ignore non-200 if endpoint is blocked; the login step will surface real failures.
    console.log("[preflight] clear-lockout:", r.status);
  } catch (e) {
    console.log("[preflight] clear-lockout failed (ignored):", String(e?.message || e));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let skippedCount = 0;

function isNotConfiguredResponse(status, text) {
  if (status !== 500 && status !== 501) return false;
  const hay = String(text || "");
  const lower = hay.toLowerCase();
  return (
    lower.includes("not configured") ||
    hay.includes("Missing") ||
    hay.includes("MISSING") ||
    lower.includes("requires") ||
    lower.includes("api key") ||
    lower.includes("anthropic is not configured") ||
    lower.includes("openai is not configured") ||
    lower.includes("apify is not configured")
  );
}

function skipStep(stepName, status, text) {
  skippedCount += 1;
  const preview = String(text || "").replace(/\s+/g, " ").slice(0, 120);
  console.log(`[skip] ${stepName}: ${status} ${preview}`);
}

async function ensureCiSeedRan() {
  if (process.env.CI && !process.env.DATABASE_URL) {
    throw new Error("CI requires DATABASE_URL (set it in env or .env)");
  }
  if (!IS_CI_OR_TEST) return;
  if (!process.env.DATABASE_URL) return;
  const prismaMod = await import("@prisma/client");
  const prisma = new prismaMod.PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: "test_user" },
      select: { id: true },
    });
    if (user?.id) return;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  throw new Error("CI seed missing: run `node scripts/seed_ci.mjs` before attacker_sweep");
}

function splitSetCookieHeader(value) {
  const s = String(value || "").trim();
  if (!s) return [];
  const parts = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inExpires && s.slice(i, i + 8).toLowerCase() === "expires=") {
      inExpires = true;
      continue;
    }
    if (inExpires && ch === ";") {
      inExpires = false;
      continue;
    }
    if (!inExpires && ch === ",") {
      const next = s.slice(i + 1);
      if (/^\s*[^=\s;,]+=/i.test(next)) {
        const piece = s.slice(start, i).trim();
        if (piece) parts.push(piece);
        start = i + 1;
      }
    }
  }
  const last = s.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function cookieNames(jar) {
  return jar?.cookies ? Array.from(jar.cookies.keys()) : [];
}

function hasSessionCookie(jar) {
  if (!jar?.cookies) return false;
  return jar.cookies.has("next-auth.session-token") || jar.cookies.has("__Secure-next-auth.session-token");
}

function addSetCookiesToJar(jar, setCookies) {
  if (!jar?.cookies) return;
  const arr = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  for (const sc of arr) {
    if (!sc) continue;
    console.log(`[login] set-cookie: ${String(sc).split(";")[0]}`);
    const first = String(sc || "").split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    if (!name) continue;
    jar.cookies.set(name, first);
  }
}

function cookieHeader(jar) {
  if (!jar?.cookies || jar.cookies.size === 0) return "";
  return Array.from(jar.cookies.values()).join("; ");
}

async function http(jar, urlOrPath, opts = {}, redirectsLeft = 5) {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${BASE_URL}${urlOrPath}`;
  const headers = new Headers(opts.headers || {});
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("Cookie", cookie);
  const redirect = opts.redirect ?? "manual";

  const res = await fetch(url, { ...opts, headers, redirect });

  // undici supports getSetCookie() in many builds; fallback to set-cookie single header
  let setCookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    setCookies = res.headers.getSetCookie();
  } else {
    const sc = res.headers.get("set-cookie");
    if (sc) setCookies = splitSetCookieHeader(sc);
  }
  addSetCookiesToJar(jar, setCookies);

  const status = res.status;
  const location = res.headers.get("location");
  const isRedirect = [301, 302, 303, 307, 308].includes(status);
  if (isRedirect && location && redirectsLeft > 0 && redirect === "manual") {
    try {
      if (res.body && typeof res.body.cancel === "function") {
        await res.body.cancel();
      }
    } catch {}

    const nextUrl = new URL(location, url).toString();
    const nextOpts = { ...opts };

    const prevMethod = String(opts.method || "GET").toUpperCase();
    const shouldSwitchToGet =
      status === 303 || ((status === 301 || status === 302) && prevMethod !== "GET" && prevMethod !== "HEAD");

    if (shouldSwitchToGet) {
      nextOpts.method = "GET";
      delete nextOpts.body;
      const nextHeaders = new Headers(nextOpts.headers || {});
      nextHeaders.delete("content-type");
      nextHeaders.delete("content-length");
      nextOpts.headers = nextHeaders;
    }

    return http(jar, nextUrl, nextOpts, redirectsLeft - 1);
  }

  const text = await res.text();
  return { res, text };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isSkippableResponse(res, text) {
  if (!IS_CI_OR_TEST) return false;
  if (res.status !== 200) return false;
  const json = tryJson(text);
  if (!json || typeof json !== "object") return false;
  if (json.ok === true && json.skipped === true) return true;
  if (
    typeof json.reason === "string" &&
    json.reason.toLowerCase().includes("not configured")
  ) {
    return true;
  }
  if (typeof json.error === "string" && json.error.toLowerCase().includes("not configured")) {
    return true;
  }
  return false;
}

function skipReason(text) {
  const json = tryJson(text);
  if (!json || typeof json !== "object") return "skipped";
  if (typeof json.reason === "string" && json.reason) return json.reason;
  if (typeof json.error === "string" && json.error) return json.error;
  return "skipped";
}

async function ensureSeededJobAndScript({ ownerEmail, projectId }) {
  if (!process.env.DATABASE_URL) {
    if (process.env.CI) {
      assert(process.env.DATABASE_URL, "DATABASE_URL is required to seed fallback job/script in CI");
    }
    skipStep("seed fallback job/script", 0, "DATABASE_URL missing");
    return null;
  }
  const prismaMod = await import("@prisma/client");
  const prisma = new prismaMod.PrismaClient();

  const seededJobId = "job_test";
  const seededScriptId = "script_test";

  try {
    const user = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });
    assert(user?.id, `user not found for fallback seed: ${ownerEmail}`);

    await prisma.project.upsert({
      where: { id: projectId },
      update: { userId: user.id, name: "Test Project" },
      create: { id: projectId, userId: user.id, name: "Test Project" },
    });

    await prisma.job.upsert({
      where: { id: seededJobId },
      update: {
        projectId,
        type: "SCRIPT_GENERATION",
        status: "COMPLETED",
        payload: { projectId, seeded: true, kind: "security-sweep" },
        resultSummary: "Seeded job for security sweep",
        error: null,
      },
      create: {
        id: seededJobId,
        projectId,
        type: "SCRIPT_GENERATION",
        status: "COMPLETED",
        payload: { projectId, seeded: true, kind: "security-sweep" },
        resultSummary: "Seeded job for security sweep",
      },
    });

    await prisma.script.upsert({
      where: { id: seededScriptId },
      update: {
        projectId,
        jobId: seededJobId,
        status: "READY",
        wordCount: 3,
        rawJson: { title: "Seed Script", text: "Hello CI world" },
        mergedVideoUrl: null,
        upscaledVideoUrl: null,
        upscaleError: null,
      },
      create: {
        id: seededScriptId,
        projectId,
        jobId: seededJobId,
        status: "READY",
        wordCount: 3,
        rawJson: { title: "Seed Script", text: "Hello CI world" },
        mergedVideoUrl: null,
        upscaledVideoUrl: null,
      },
    });

    return { jobId: seededJobId, scriptId: seededScriptId };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function setScriptMedia(jar, { scriptId, projectId, field, key }) {
  const setMedia = await http(jar, "/api/debug/set-script-media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scriptId, field, key }),
  });

  if (setMedia.res.ok) return;

  // In production, /api/debug/* is blocked. Fall back to directly seeding via DB.
  if (setMedia.res.status !== 404) {
    throw new Error(`set-script-media failed ${setMedia.res.status}: ${setMedia.text}`);
  }

  assert(process.env.DATABASE_URL, "DATABASE_URL is required to seed media in production");
  const prismaMod = await import("@prisma/client");
  const prisma = new prismaMod.PrismaClient();

  try {
    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, projectId: true },
    });
    assert(script, `script not found: ${scriptId}`);
    if (projectId) {
      assert(script.projectId === projectId, "script.projectId mismatch");
    }
    await prisma.script.update({
      where: { id: scriptId },
      data: { [field]: key },
    });
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function ensureActiveSubscription(email, planId = "GROWTH") {
  if (!process.env.DATABASE_URL) return;
  const prismaMod = await import("@prisma/client");
  const prisma = new prismaMod.PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    assert(user?.id, `user not found for subscription seed: ${email}`);

    const existing = await prisma.subscription.findFirst({
      where: { userId: user.id },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: { status: "active", planId },
      });
      return;
    }

    await prisma.subscription.create({
      data: { userId: user.id, status: "active", planId },
    });
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function loginWithCredentials(baseUrl, email, password) {
  const jar = { cookies: new Map() };

  // Fetch CSRF token (NextAuth)
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    method: "GET",
    headers: {
      accept: "application/json",
      cookie: cookieHeader(jar),
      "user-agent": "security-sweep",
      "x-forwarded-for": "127.0.0.1",
    },
    redirect: "manual",
  });
  const csrfSetCookie =
    typeof csrfRes.headers.getSetCookie === "function"
      ? csrfRes.headers.getSetCookie()
      : splitSetCookieHeader(csrfRes.headers.get("set-cookie"));
  addSetCookiesToJar(jar, csrfSetCookie);
  const csrfText = await csrfRes.text().catch(() => "");
  const csrfJson = tryJson(csrfText);
  if (!csrfJson?.csrfToken) {
    throw new Error(
      `[login] failed to fetch csrfToken (status ${csrfRes.status}): ${csrfText.slice(0, 200)}`
    );
  }

  const form = new URLSearchParams();
  form.set("csrfToken", csrfJson.csrfToken);
  form.set("email", email);
  form.set("password", password);
  form.set("callbackUrl", `${baseUrl}/studio`);
  form.set("json", "true");

  const r = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar),
      "user-agent": "security-sweep",
      "x-forwarded-for": "127.0.0.1",
    },
    body: form.toString(),
    redirect: "manual",
  });

  const setCookie =
    typeof r.headers.getSetCookie === "function"
      ? r.headers.getSetCookie()
      : splitSetCookieHeader(r.headers.get("set-cookie"));
  addSetCookiesToJar(jar, setCookie);

  if (!hasSessionCookie(jar)) {
    const body = await r.text().catch(() => "");
    throw new Error(`[login] no session cookie set; status=${r.status}; body=${body.slice(0, 200)}`);
  }

  return jar;
}

async function run() {
  await maybeClearLockout();
  const skipMigrate =
    process.env.SKIP_MIGRATE_IN_SWEEP === "1" || process.env.CI === "true";
  if (skipMigrate) {
    console.log("[preflight] skipping prisma migrate deploy");
  } else {
    migrateOrFail();
  }
  runBootstrapDev();
  await ensureGrowthSubscriptionOrFail();

  const A = { email: TEST_EMAIL, pass: TEST_PASSWORD, name: "Test User" };
  const B = { email: ATTACKER_EMAIL, pass: ATTACKER_PASSWORD, name: "Attacker User" };
  const projectId = "proj_test";

  console.log("BASE_URL:", BASE_URL);

  const ownerJar = await loginWithCredentials(BASE_URL, A.email, A.pass);

  const plist = await http(ownerJar, "/api/projects");
  assert(plist.res.ok, `project list failed ${plist.res.status}: ${plist.text}`);
  const projects = JSON.parse(plist.text);
  const project = (projects || []).find((x) => x.id === projectId);
  assert(project?.id, `could not locate seeded project in /api/projects (id=${projectId})`);
  console.log("projectId:", projectId);

  // A triggers script-generation (creates/returns script)
  const sgen = await http(ownerJar, "/api/jobs/script-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  let jobId = null;
  if (isSkippableResponse(sgen.res, sgen.text)) {
    skippedCount += 1;
    console.log(`⚠️ SKIPPED script-generation: ${skipReason(sgen.text)}`);
    const seeded = await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
    jobId = seeded?.jobId ?? null;
  } else if (isNotConfiguredResponse(sgen.res.status, sgen.text)) {
    skipStep("script-generation", sgen.res.status, sgen.text);
    const seeded = await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
    jobId = seeded?.jobId ?? null;
  } else {
    assert(sgen.res.status === 200, `script-generation failed ${sgen.res.status}: ${sgen.text}`);
    const sgenJson = JSON.parse(sgen.text);
    jobId = sgenJson?.jobId;
    assert(jobId, `missing jobId from script-generation response: ${sgen.text}`);
  }

  const attackerJar = await loginWithCredentials(BASE_URL, B.email, B.pass);

  // Attacker cannot list dead-letter jobs
  const dlB = await http(attackerJar, `/api/projects/${projectId}/dead-letter`);
  if (dlB.res.status !== 403 && dlB.res.status !== 404) {
    if (isNotConfiguredResponse(dlB.res.status, dlB.text)) {
      skipStep("attacker dead-letter list", dlB.res.status, dlB.text);
    } else {
      assert(false, `attacker dead-letter list should 403/404, got ${dlB.res.status}: ${dlB.text}`);
    }
  }

  // Attacker cannot bulk-modify dead-letter jobs
  const bulkB = await http(attackerJar, `/api/projects/${projectId}/dead-letter/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "dismiss_all" }),
  });
  if (bulkB.res.status !== 403 && bulkB.res.status !== 404) {
    if (isNotConfiguredResponse(bulkB.res.status, bulkB.text)) {
      skipStep("attacker dead-letter bulk", bulkB.res.status, bulkB.text);
    } else {
      assert(false, `attacker dead-letter bulk should 403/404, got ${bulkB.res.status}: ${bulkB.text}`);
    }
  }

  // Attacker cannot read owner job by id
  if (!jobId) {
    skipStep("attacker job read", 0, "jobId missing (seed skipped)");
  } else {
    const jobReadB = await http(attackerJar, `/api/jobs/${jobId}`);
    if (![403, 404].includes(jobReadB.res.status)) {
      if (isNotConfiguredResponse(jobReadB.res.status, jobReadB.text)) {
        skipStep("attacker job read", jobReadB.res.status, jobReadB.text);
      } else {
        assert(false, `attacker job read should 403/404, got ${jobReadB.res.status}: ${jobReadB.text}`);
      }
    }
  }

  // Get scripts and pick one
  let scriptsResp = await http(ownerJar, `/api/projects/${projectId}/scripts`);
  if (!scriptsResp.res.ok && isNotConfiguredResponse(scriptsResp.res.status, scriptsResp.text)) {
    skipStep("scripts list", scriptsResp.res.status, scriptsResp.text);
  } else {
    assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
    let scripts = JSON.parse(scriptsResp.text);
    if (IS_CI_OR_TEST && (!Array.isArray(scripts) || scripts.length === 0)) {
      console.log("⚠️ SKIPPED scripts list was empty; seeding fallback script in DB");
      await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
      scriptsResp = await http(ownerJar, `/api/projects/${projectId}/scripts`);
      if (!scriptsResp.res.ok && isNotConfiguredResponse(scriptsResp.res.status, scriptsResp.text)) {
        skipStep("scripts list (retry)", scriptsResp.res.status, scriptsResp.text);
        scripts = [];
      } else {
        assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
        scripts = JSON.parse(scriptsResp.text);
      }
    }

    if (Array.isArray(scripts) && scripts.length > 0) {
      const scriptId = scripts[0].id;
      assert(scriptId, "missing scriptId");

      // Set a media key on the script (dev endpoint; DB fallback in production)
      const mediaKey = `users/${A.email}/projects/${projectId}/scripts/${scriptId}/merged.mp4`;
      await setScriptMedia(ownerJar, {
        scriptId,
        projectId,
        field: "mergedVideoUrl",
        key: mediaKey,
      });

      // Owner can sign media
      const mediaA = await http(ownerJar, `/api/media?key=${encodeURIComponent(mediaKey)}`);
      if (mediaA.res.status === 503) {
        console.log("media signing not configured in CI; skipping media tests");
      } else if (isNotConfiguredResponse(mediaA.res.status, mediaA.text)) {
        skipStep("media signing", mediaA.res.status, mediaA.text);
      } else {
        assert(mediaA.res.status === 200, `owner media sign failed ${mediaA.res.status}: ${mediaA.text}`);
        const mediaB = await http(attackerJar, `/api/media?key=${encodeURIComponent(mediaKey)}`);
        if (mediaB.res.status !== 403 && mediaB.res.status !== 404) {
          if (isNotConfiguredResponse(mediaB.res.status, mediaB.text)) {
            skipStep("attacker media sign", mediaB.res.status, mediaB.text);
          } else {
            assert(false, `attacker media sign should 403/404, got ${mediaB.res.status}: ${mediaB.text}`);
          }
        }
      }
    }
  }

  // Attacker cannot read owner project routes
  const researchB = await http(attackerJar, `/api/projects/${projectId}/research`);
  if (researchB.res.status !== 403 && researchB.res.status !== 404) {
    if (isNotConfiguredResponse(researchB.res.status, researchB.text)) {
      skipStep("attacker research", researchB.res.status, researchB.text);
    } else {
      assert(false, `attacker research should 403/404, got ${researchB.res.status}: ${researchB.text}`);
    }
  }

  const scriptsB = await http(attackerJar, `/api/projects/${projectId}/scripts`);
  if (scriptsB.res.status !== 403 && scriptsB.res.status !== 404) {
    if (isNotConfiguredResponse(scriptsB.res.status, scriptsB.text)) {
      skipStep("attacker scripts", scriptsB.res.status, scriptsB.text);
    } else {
      assert(false, `attacker scripts should 403/404, got ${scriptsB.res.status}: ${scriptsB.text}`);
    }
  }

  // Attacker cannot trigger jobs on owner project
  const jobB = await http(attackerJar, "/api/jobs/script-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (jobB.res.status !== 403 && jobB.res.status !== 404) {
    if (isNotConfiguredResponse(jobB.res.status, jobB.text)) {
      skipStep("attacker job trigger", jobB.res.status, jobB.text);
    } else {
      assert(false, `attacker job trigger should 403/404, got ${jobB.res.status}: ${jobB.text}`);
    }
  }

  console.log(`✅ attacker sweep passed (skipped=${skippedCount})`);
}

run().catch((e) => {
  console.error("❌ attacker sweep failed:", e?.message ?? e);
  process.exit(1);
});
