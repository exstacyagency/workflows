// lib/authAbuseGuard.ts
import { cfg } from "@/lib/config";
type Kind = "register" | "login";

type Entry = {
  count: number;
  resetAt: number;
  lockedUntil: number;
};

const store = new Map<string, Entry>();

const WINDOW_MS = Number(cfg().raw("AUTH_WINDOW_MS") ?? 10 * 60_000); // 10 min
const MAX_ATTEMPTS = Number(cfg().raw("AUTH_MAX_ATTEMPTS") ?? 5);
const LOCKOUT_MS = Number(cfg().raw("AUTH_LOCKOUT_MS") ?? 15 * 60_000); // 15 min

function now() {
  return Date.now();
}

function key(kind: Kind, scope: "ip" | "email", value: string) {
  return `${kind}:${scope}:${value}`;
}

function normEmail(email: string) {
  return email.trim().toLowerCase();
}

function getOrInit(k: string) {
  const t = now();
  const e = store.get(k);
  if (!e) {
    const fresh: Entry = { count: 0, resetAt: t + WINDOW_MS, lockedUntil: 0 };
    store.set(k, fresh);
    return fresh;
  }
  if (t >= e.resetAt) {
    e.count = 0;
    e.resetAt = t + WINDOW_MS;
    // do not clear lockout automatically; lockout uses lockedUntil
  }
  if (e.lockedUntil && t >= e.lockedUntil) {
    e.lockedUntil = 0;
    e.count = 0;
    e.resetAt = t + WINDOW_MS;
  }
  return e;
}

function cleanupIfHuge() {
  // prevent unbounded growth (very simple)
  if (store.size < 5000) return;
  const t = now();
  store.forEach((e, k) => {
    if (t >= e.resetAt && (!e.lockedUntil || t >= e.lockedUntil)) {
      store.delete(k);
    }
  });
}

export function checkAuthAllowed(params: {
  kind: Kind;
  ip?: string | null;
  email?: string | null;
}) {
  cleanupIfHuge();
  const t = now();

  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;

  const ipEntry = getOrInit(key(params.kind, "ip", ip));
  if (ipEntry.lockedUntil && t < ipEntry.lockedUntil) {
    return {
      allowed: false,
      reason: "ip_lockout",
      retryAfterMs: ipEntry.lockedUntil - t,
    };
  }

  if (email) {
    const emailEntry = getOrInit(key(params.kind, "email", email));
    if (emailEntry.lockedUntil && t < emailEntry.lockedUntil) {
      return {
        allowed: false,
        reason: "email_lockout",
        retryAfterMs: emailEntry.lockedUntil - t,
      };
    }
  }

  return { allowed: true as const };
}

export function consumeAuthAttempt(params: {
  kind: Kind;
  ip?: string | null;
  email?: string | null;
}) {
  cleanupIfHuge();
  const t = now();
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;

  const ipEntry = getOrInit(key(params.kind, "ip", ip));
  if (ipEntry.lockedUntil && t < ipEntry.lockedUntil) {
    return { allowed: false as const, retryAfterMs: ipEntry.lockedUntil - t };
  }

  // count every attempt for rate limiting
  ipEntry.count += 1;
  if (ipEntry.count >= MAX_ATTEMPTS) {
    ipEntry.lockedUntil = t + LOCKOUT_MS;
    return { allowed: false as const, retryAfterMs: ipEntry.lockedUntil - t };
  }

  // For register, email-scoped limiting is optional; keep it for login only.
  if (params.kind === "login" && email) {
    const emailEntry = getOrInit(key(params.kind, "email", email));
    if (emailEntry.lockedUntil && t < emailEntry.lockedUntil) {
      return {
        allowed: false as const,
        retryAfterMs: emailEntry.lockedUntil - t,
      };
    }
    emailEntry.count += 1;
    if (emailEntry.count >= MAX_ATTEMPTS) {
      emailEntry.lockedUntil = t + LOCKOUT_MS;
      return {
        allowed: false as const,
        retryAfterMs: emailEntry.lockedUntil - t,
      };
    }
  }

  return { allowed: true as const };
}

export function recordAuthFailure(params: {
  kind: Kind;
  ip?: string | null;
  email?: string | null;
}) {
  if (params.kind !== "login") return;

  cleanupIfHuge();
  const t = now();
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;

  const ipEntry = getOrInit(key(params.kind, "ip", ip));
  ipEntry.count += 1;
  if (ipEntry.count >= MAX_ATTEMPTS) {
    ipEntry.lockedUntil = t + LOCKOUT_MS;
  }

  if (email) {
    const emailEntry = getOrInit(key(params.kind, "email", email));
    emailEntry.count += 1;
    if (emailEntry.count >= MAX_ATTEMPTS) {
      emailEntry.lockedUntil = t + LOCKOUT_MS;
    }
  }
}

export function recordAuthSuccess(params: {
  kind: Kind;
  ip?: string | null;
  email?: string | null;
}) {
  if (params.kind !== "login") return; // do not reset register attempt counters

  cleanupIfHuge();
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;

  const ipEntry = getOrInit(key(params.kind, "ip", ip));
  ipEntry.count = 0;
  ipEntry.lockedUntil = 0;
  ipEntry.resetAt = now() + WINDOW_MS;

  if (email) {
    const emailEntry = getOrInit(key(params.kind, "email", email));
    emailEntry.count = 0;
    emailEntry.lockedUntil = 0;
    emailEntry.resetAt = now() + WINDOW_MS;
  }
}
