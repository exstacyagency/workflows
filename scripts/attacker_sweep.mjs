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

async function login(email, password) {
  const jar = { cookies: new Map() };

  // get CSRF token (sets csrf cookie)
  const csrfResp = await http(jar, "/api/auth/csrf");
  assert(csrfResp.res.ok, `csrf failed ${csrfResp.res.status}: ${csrfResp.text}`);
  const csrf = JSON.parse(csrfResp.text).csrfToken;
  assert(csrf, "missing csrfToken");

  const form = new URLSearchParams();
  form.set("csrfToken", csrf);
  form.set("email", email);
  form.set("password", password);
  form.set("callbackUrl", `${BASE_URL}/projects`);

  const callback = await http(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const { res } = callback;

  // NextAuth returns 302 on success
  assert(res.status === 302 || res.status === 200, `login unexpected ${res.status}`);

  if (!hasSessionCookie(jar)) {
    const loc = res.headers.get("location");
    const bodyPreview = String(callback.text || "").slice(0, 400);
    throw new Error(
      `missing session cookie after login (BASE_URL=${BASE_URL}) cookies=${JSON.stringify(cookieNames(jar))} lastAuthStatus=${res.status} lastAuthLocation=${loc} body=${bodyPreview}`
    );
  }

  // verify session
  const sess = await http(jar, "/api/auth/session");
  assert(sess.res.ok, `session failed ${sess.res.status}: ${sess.text}`);
  const sjson = tryJson(sess.text);
  if (!sjson) {
    throw new Error(`session json parse failed: ${sess.text}`);
  }
  if (!sjson?.user) {
    throw new Error(
      `session user missing (BASE_URL=${BASE_URL}) cookies=${JSON.stringify(cookieNames(jar))} session=${sess.text}`
    );
  }
  assert(sjson?.user?.email === email, `session user mismatch: ${sess.text}`);

  return jar;
}

async function run() {
  await ensureCiSeedRan();

  const A = { email: "test@local.dev", pass: "TestPassword123!", name: "Test User" };
  const B = { email: "attacker@local.dev", pass: "TestPassword123!", name: "Attacker User" };
  const projectId = "proj_test";

  console.log("BASE_URL:", BASE_URL);

  const jarA = await login(A.email, A.pass);
  const jarB = await login(B.email, B.pass);

  const plist = await http(jarA, "/api/projects");
  assert(plist.res.ok, `project list failed ${plist.res.status}: ${plist.text}`);
  const projects = JSON.parse(plist.text);
  const project = (projects || []).find((x) => x.id === projectId);
  assert(project?.id, `could not locate seeded project in /api/projects (id=${projectId})`);
  console.log("projectId:", projectId);

  // A triggers script-generation (creates/returns script)
  const sgen = await http(jarA, "/api/jobs/script-generation", {
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

  // Attacker cannot list dead-letter jobs
  const dlB = await http(jarB, `/api/projects/${projectId}/dead-letter`);
  if (dlB.res.status !== 403) {
    if (isNotConfiguredResponse(dlB.res.status, dlB.text)) {
      skipStep("attacker dead-letter list", dlB.res.status, dlB.text);
    } else {
      assert(false, `attacker dead-letter list should 403, got ${dlB.res.status}: ${dlB.text}`);
    }
  }

  // Attacker cannot bulk-modify dead-letter jobs
  const bulkB = await http(jarB, `/api/projects/${projectId}/dead-letter/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "dismiss_all" }),
  });
  if (bulkB.res.status !== 403) {
    if (isNotConfiguredResponse(bulkB.res.status, bulkB.text)) {
      skipStep("attacker dead-letter bulk", bulkB.res.status, bulkB.text);
    } else {
      assert(false, `attacker dead-letter bulk should 403, got ${bulkB.res.status}: ${bulkB.text}`);
    }
  }

  // Attacker cannot read owner job by id
  if (!jobId) {
    skipStep("attacker job read", 0, "jobId missing (seed skipped)");
  } else {
    const jobReadB = await http(jarB, `/api/jobs/${jobId}`);
    if (![403, 404].includes(jobReadB.res.status)) {
      if (isNotConfiguredResponse(jobReadB.res.status, jobReadB.text)) {
        skipStep("attacker job read", jobReadB.res.status, jobReadB.text);
      } else {
        assert(false, `attacker job read should 403/404, got ${jobReadB.res.status}: ${jobReadB.text}`);
      }
    }
  }

  // Get scripts and pick one
  let scriptsResp = await http(jarA, `/api/projects/${projectId}/scripts`);
  if (!scriptsResp.res.ok && isNotConfiguredResponse(scriptsResp.res.status, scriptsResp.text)) {
    skipStep("scripts list", scriptsResp.res.status, scriptsResp.text);
  } else {
    assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
    let scripts = JSON.parse(scriptsResp.text);
    if (IS_CI_OR_TEST && (!Array.isArray(scripts) || scripts.length === 0)) {
      console.log("⚠️ SKIPPED scripts list was empty; seeding fallback script in DB");
      await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
      scriptsResp = await http(jarA, `/api/projects/${projectId}/scripts`);
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
      await setScriptMedia(jarA, {
        scriptId,
        projectId,
        field: "mergedVideoUrl",
        key: mediaKey,
      });

      // Owner can sign media
      const mediaA = await http(jarA, `/api/media?key=${encodeURIComponent(mediaKey)}`);
      if (mediaA.res.status === 503) {
        console.log("media signing not configured in CI; skipping media tests");
      } else if (isNotConfiguredResponse(mediaA.res.status, mediaA.text)) {
        skipStep("media signing", mediaA.res.status, mediaA.text);
      } else {
        assert(mediaA.res.status === 200, `owner media sign failed ${mediaA.res.status}: ${mediaA.text}`);
        const mediaB = await http(jarB, `/api/media?key=${encodeURIComponent(mediaKey)}`);
        if (mediaB.res.status !== 403) {
          if (isNotConfiguredResponse(mediaB.res.status, mediaB.text)) {
            skipStep("attacker media sign", mediaB.res.status, mediaB.text);
          } else {
            assert(false, `attacker media sign should 403, got ${mediaB.res.status}: ${mediaB.text}`);
          }
        }
      }
    }
  }

  // Attacker cannot read owner project routes
  const researchB = await http(jarB, `/api/projects/${projectId}/research`);
  if (researchB.res.status !== 403) {
    if (isNotConfiguredResponse(researchB.res.status, researchB.text)) {
      skipStep("attacker research", researchB.res.status, researchB.text);
    } else {
      assert(false, `attacker research should 403, got ${researchB.res.status}: ${researchB.text}`);
    }
  }

  const scriptsB = await http(jarB, `/api/projects/${projectId}/scripts`);
  if (scriptsB.res.status !== 403) {
    if (isNotConfiguredResponse(scriptsB.res.status, scriptsB.text)) {
      skipStep("attacker scripts", scriptsB.res.status, scriptsB.text);
    } else {
      assert(false, `attacker scripts should 403, got ${scriptsB.res.status}: ${scriptsB.text}`);
    }
  }

  // Attacker cannot trigger jobs on owner project
  const jobB = await http(jarB, "/api/jobs/script-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (jobB.res.status !== 403) {
    if (isNotConfiguredResponse(jobB.res.status, jobB.text)) {
      skipStep("attacker job trigger", jobB.res.status, jobB.text);
    } else {
      assert(false, `attacker job trigger should 403, got ${jobB.res.status}: ${jobB.text}`);
    }
  }

  console.log(`✅ attacker sweep passed (skipped=${skippedCount})`);
}

run().catch((e) => {
  console.error("❌ attacker sweep failed:", e?.message ?? e);
  process.exit(1);
});
