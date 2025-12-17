const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const IS_CI_OR_TEST = process.env.CI === "true" || process.env.NODE_ENV === "test";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function ensureCiSeedRan() {
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

// Minimal cookie jar
class CookieJar {
  constructor() { this.map = new Map(); }
  addSetCookies(setCookies) {
    if (!setCookies) return;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const sc of arr) {
      if (!sc) continue;
      const first = sc.split(";")[0];
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.map.set(name, value);
    }
  }
  header() {
    return Array.from(this.map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function http(jar, path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = new Headers(opts.headers || {});
  if (jar) {
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
  }
  const res = await fetch(url, { ...opts, headers, redirect: "manual" });

  // undici supports getSetCookie() in many builds; fallback to set-cookie single header
  let setCookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    setCookies = res.headers.getSetCookie();
  } else {
    const sc = res.headers.get("set-cookie");
    if (sc) setCookies = [sc];
  }
  if (jar) jar.addSetCookies(setCookies);

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
  assert(process.env.DATABASE_URL, "DATABASE_URL is required to seed fallback job/script in CI");
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
  const jar = new CookieJar();

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

  const { res } = await http(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  // NextAuth returns 302 on success
  assert(res.status === 302 || res.status === 200, `login unexpected ${res.status}`);

  // verify session
  const sess = await http(jar, "/api/auth/session");
  assert(sess.res.ok, `session failed ${sess.res.status}: ${sess.text}`);
  const sjson = JSON.parse(sess.text);
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
    console.log(`⚠️ SKIPPED script-generation: ${skipReason(sgen.text)}`);
    const seeded = await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
    jobId = seeded.jobId;
  } else {
    assert(sgen.res.status === 200, `script-generation failed ${sgen.res.status}: ${sgen.text}`);
    const sgenJson = JSON.parse(sgen.text);
    jobId = sgenJson?.jobId;
    assert(jobId, `missing jobId from script-generation response: ${sgen.text}`);
  }

  // Attacker cannot list dead-letter jobs
  const dlB = await http(jarB, `/api/projects/${projectId}/dead-letter`);
  assert(dlB.res.status === 403, `attacker dead-letter list should 403, got ${dlB.res.status}: ${dlB.text}`);

  // Attacker cannot bulk-modify dead-letter jobs
  const bulkB = await http(jarB, `/api/projects/${projectId}/dead-letter/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "dismiss_all" }),
  });
  assert(bulkB.res.status === 403, `attacker dead-letter bulk should 403, got ${bulkB.res.status}: ${bulkB.text}`);

  // Attacker cannot read owner job by id
  const jobReadB = await http(jarB, `/api/jobs/${jobId}`);
  assert([403, 404].includes(jobReadB.res.status), `attacker job read should 403/404, got ${jobReadB.res.status}: ${jobReadB.text}`);

  // Get scripts and pick one
  let scriptsResp = await http(jarA, `/api/projects/${projectId}/scripts`);
  assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
  let scripts = JSON.parse(scriptsResp.text);
  if (IS_CI_OR_TEST && (!Array.isArray(scripts) || scripts.length === 0)) {
    console.log("⚠️ SKIPPED scripts list was empty; seeding fallback script in DB");
    await ensureSeededJobAndScript({ ownerEmail: A.email, projectId });
    scriptsResp = await http(jarA, `/api/projects/${projectId}/scripts`);
    assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
    scripts = JSON.parse(scriptsResp.text);
  }
  assert(Array.isArray(scripts) && scripts.length > 0, "no scripts returned to seed media");
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
  } else {
    assert(mediaA.res.status === 200, `owner media sign failed ${mediaA.res.status}: ${mediaA.text}`);
    const mediaB = await http(jarB, `/api/media?key=${encodeURIComponent(mediaKey)}`);
    assert(mediaB.res.status === 403, `attacker media sign should 403, got ${mediaB.res.status}: ${mediaB.text}`);
  }

  // Attacker cannot read owner project routes
  const researchB = await http(jarB, `/api/projects/${projectId}/research`);
  assert(researchB.res.status === 403, `attacker research should 403, got ${researchB.res.status}: ${researchB.text}`);

  const scriptsB = await http(jarB, `/api/projects/${projectId}/scripts`);
  assert(scriptsB.res.status === 403, `attacker scripts should 403, got ${scriptsB.res.status}: ${scriptsB.text}`);

  // Attacker cannot trigger jobs on owner project
  const jobB = await http(jarB, "/api/jobs/script-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  assert(jobB.res.status === 403, `attacker job trigger should 403, got ${jobB.res.status}: ${jobB.text}`);

  console.log("✅ attacker sweep passed");
}

run().catch((e) => {
  console.error("❌ attacker sweep failed:", e?.message ?? e);
  process.exit(1);
});
