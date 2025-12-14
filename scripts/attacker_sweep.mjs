const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

async function register(email, password, name) {
  const jar = new CookieJar();
  const { res, text } = await http(jar, "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  // 201 created or 409 already exists
  if (res.status === 201) return;
  if (res.status === 409) return;
  throw new Error(`register failed ${res.status}: ${text}`);
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
  const ts = Date.now();
  const A = { email: `sweepA_${ts}@example.com`, pass: "testpassword", name: "Sweep A" };
  const B = { email: `sweepB_${ts}@example.com`, pass: "testpassword", name: "Sweep B" };

  console.log("BASE_URL:", BASE_URL);

  await register(A.email, A.pass, A.name);
  await register(B.email, B.pass, B.name);

  const jarA = await login(A.email, A.pass);
  const jarB = await login(B.email, B.pass);

  // A creates project
  const projName = `Sweep Project ${ts}`;
  const pcreate = await http(jarA, "/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: projName }),
  });
  assert(pcreate.res.status === 201 || pcreate.res.status === 200, `project create failed ${pcreate.res.status}: ${pcreate.text}`);

  // Find projectId from list
  const plist = await http(jarA, "/api/projects");
  assert(plist.res.ok, `project list failed ${plist.res.status}: ${plist.text}`);
  const projects = JSON.parse(plist.text);
  const project = (projects || []).find((x) => x.name === projName);
  assert(project?.id, "could not locate created project in /api/projects");
  const projectId = project.id;
  console.log("projectId:", projectId);

  // A triggers script-generation (creates/returns script)
  const sgen = await http(jarA, "/api/jobs/script-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  assert(sgen.res.status === 200, `script-generation failed ${sgen.res.status}: ${sgen.text}`);
  const sgenJson = JSON.parse(sgen.text);
  const jobId = sgenJson?.jobId;
  assert(jobId, `missing jobId from script-generation response: ${sgen.text}`);

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
  const scriptsResp = await http(jarA, `/api/projects/${projectId}/scripts`);
  assert(scriptsResp.res.ok, `scripts failed ${scriptsResp.res.status}: ${scriptsResp.text}`);
  const scripts = JSON.parse(scriptsResp.text);
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
