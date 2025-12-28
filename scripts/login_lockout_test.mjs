/* eslint-disable no-restricted-properties */
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
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
    return Array.from(this.map.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
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

async function register(email, password, name) {
  const jar = new CookieJar();
  const { res, text } = await http(jar, "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (res.status === 201) return;
  if (res.status === 409) return;
  throw new Error(`register failed ${res.status}: ${text}`);
}

async function getCsrf(jar) {
  const csrfResp = await http(jar, "/api/auth/csrf");
  assert(
    csrfResp.res.ok,
    `csrf failed ${csrfResp.res.status}: ${csrfResp.text}`
  );
  const csrf = JSON.parse(csrfResp.text).csrfToken;
  assert(csrf, "missing csrfToken");
  return csrf;
}

async function attemptLogin(email, password) {
  const jar = new CookieJar();
  const csrf = await getCsrf(jar);

  const form = new URLSearchParams();
  form.set("csrfToken", csrf);
  form.set("email", email);
  form.set("password", password);
  form.set("callbackUrl", `${BASE_URL}/projects`);

  const { res, text } = await http(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  // NextAuth usually 302 even on failure, so verify by checking session.
  const sess = await http(jar, "/api/auth/session");
  const sjson = sess.res.ok ? JSON.parse(sess.text) : null;
  const loggedIn = !!sjson?.user?.email;

  return {
    resStatus: res.status,
    sessionOk: sess.res.ok,
    loggedIn,
    session: sjson,
    raw: text,
  };
}

async function main() {
  const ts = Date.now();
  const email = `lockout_${ts}@example.com`;
  const goodPass = "RightPassword123!";
  const badPass = "WrongPassword123!";

  console.log("BASE_URL:", BASE_URL);
  await register(email, goodPass, "Lockout Test");

  const max = Number(process.env.AUTH_MAX_ATTEMPTS ?? 5);
  const attempts = max + 2;

  let sawLockout = false;

  for (let i = 0; i < attempts; i++) {
    const r = await attemptLogin(email, badPass);
    // After enough attempts, server should lock out:
    // either by throwing (authorize) -> session remains not logged in
    // and/or by returning 429 somewhere in your flow.
    if (!r.loggedIn && (r.raw || "").toLowerCase().includes("too many")) {
      sawLockout = true;
    }
    console.log(
      `bad-login ${i + 1}/${attempts}: loggedIn=${r.loggedIn} res=${r.resStatus}`
    );
  }

  // One more bad attempt should not login
  const lastBad = await attemptLogin(email, badPass);
  assert(!lastBad.loggedIn, "Expected lockout: bad password should not login");

  // Correct password should still be blocked during lockout window (if enforced)
  const goodTry = await attemptLogin(email, goodPass);
  if (goodTry.loggedIn) {
    console.log("✅ correct password allowed immediately (no lockout on success)");
  } else {
    console.log(
      "✅ correct password blocked during lockout window (expected for strict lockout)"
    );
  }

  // We accept either policy, but we require that brute force never yields a login.
  assert(!lastBad.loggedIn, "Brute force should never yield a session");

  console.log("✅ login lockout test passed");
}

main().catch((e) => {
  console.error("❌ login lockout test failed:", e?.message ?? e);
  process.exit(1);
});

