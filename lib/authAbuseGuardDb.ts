import { cfg } from "@/lib/config";
import { prisma } from "./prisma";
import {
  recordAuthFailure as memFail,
  recordAuthSuccess as memOk,
  checkAuthAllowed as memCheck,
  consumeAuthAttempt as memConsume,
} from "./authAbuseGuard";

type Kind = "register" | "login";
type Scope = "ip" | "email";

const WINDOW_MS = Number(cfg().raw("AUTH_WINDOW_MS") ?? 10 * 60_000);
const MAX_ATTEMPTS = Number(cfg().raw("AUTH_MAX_ATTEMPTS") ?? 5);
const LOCKOUT_MS = Number(cfg().raw("AUTH_LOCKOUT_MS") ?? 15 * 60_000);

function now() {
  return Date.now();
}
function normEmail(email: string) {
  return email.trim().toLowerCase();
}

async function upsertKey(kind: Kind, scope: Scope, identifier: string) {
  const resetAt = new Date(now() + WINDOW_MS);
  return (prisma as any).authThrottle.upsert({
    where: { auth_throttle_key: { kind, scope, identifier } },
    create: { kind, scope, identifier, count: 0, resetAt },
    update: {},
  });
}

async function loadKey(kind: Kind, scope: Scope, identifier: string) {
  await upsertKey(kind, scope, identifier);
  return (prisma as any).authThrottle.findUnique({
    where: { auth_throttle_key: { kind, scope, identifier } },
  });
}

async function resetIfWindowExpired(row: any) {
  const t = now();
  const resetAtMs = row.resetAt ? new Date(row.resetAt).getTime() : 0;
  const lockedUntilMs = row.lockedUntil ? new Date(row.lockedUntil).getTime() : 0;

  if (lockedUntilMs && t >= lockedUntilMs) {
    return (prisma as any).authThrottle.update({
      where: { id: row.id },
      data: { count: 0, resetAt: new Date(t + WINDOW_MS), lockedUntil: null },
    });
  }

  if (resetAtMs && t >= resetAtMs) {
    return (prisma as any).authThrottle.update({
      where: { id: row.id },
      data: { count: 0, resetAt: new Date(t + WINDOW_MS) },
    });
  }

  return row;
}

export async function checkAuthAllowedDb(params: {
  kind: Kind;
  ip?: string | null;
  email?: string | null;
}) {
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;
  const t = now();

  try {
    const ipRow0 = await loadKey(params.kind, "ip", ip);
    const ipRow = ipRow0 ? await resetIfWindowExpired(ipRow0) : null;
    if (ipRow?.lockedUntil && t < new Date(ipRow.lockedUntil).getTime()) {
      return {
        allowed: false as const,
        reason: "ip_lockout",
        retryAfterMs: new Date(ipRow.lockedUntil).getTime() - t,
      };
    }

    if (params.kind === "login" && email) {
      const emRow0 = await loadKey(params.kind, "email", email);
      const emRow = emRow0 ? await resetIfWindowExpired(emRow0) : null;
      if (emRow?.lockedUntil && t < new Date(emRow.lockedUntil).getTime()) {
        return {
          allowed: false as const,
          reason: "email_lockout",
          retryAfterMs: new Date(emRow.lockedUntil).getTime() - t,
        };
      }
    }

    return { allowed: true as const };
  } catch (e) {
    // fallback to memory if DB is down
    return memCheck({ kind: params.kind, ip, email: email ?? undefined }) as any;
  }
}

export async function consumeRegisterAttemptDb(params: {
  ip?: string | null;
  email?: string | null;
}) {
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;
  const t = now();

  try {
    const ipRow0 = await loadKey("register", "ip", ip);
    const ipRow = ipRow0 ? await resetIfWindowExpired(ipRow0) : null;
    if (ipRow?.lockedUntil && t < new Date(ipRow.lockedUntil).getTime()) {
      return {
        allowed: false as const,
        retryAfterMs: new Date(ipRow.lockedUntil).getTime() - t,
      };
    }

    const nextCount = (ipRow?.count ?? 0) + 1;
    const lockedUntil =
      nextCount >= MAX_ATTEMPTS ? new Date(t + LOCKOUT_MS) : null;

    await (prisma as any).authThrottle.update({
      where: { id: ipRow.id },
      data: { count: nextCount, lockedUntil },
    });

    if (lockedUntil)
      return { allowed: false as const, retryAfterMs: lockedUntil.getTime() - t };
    return { allowed: true as const };
  } catch (e) {
    // fallback to memory
    return memConsume({ kind: "register", ip, email: email ?? undefined }) as any;
  }
}

export async function recordLoginFailureDb(params: {
  ip?: string | null;
  email?: string | null;
}) {
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;
  const t = now();

  try {
    const ipRow0 = await loadKey("login", "ip", ip);
    const ipRow = ipRow0 ? await resetIfWindowExpired(ipRow0) : null;

    const ipCount = (ipRow?.count ?? 0) + 1;
    const ipLocked = ipCount >= MAX_ATTEMPTS ? new Date(t + LOCKOUT_MS) : null;
    await (prisma as any).authThrottle.update({
      where: { id: ipRow.id },
      data: { count: ipCount, lockedUntil: ipLocked },
    });

    if (email) {
      const emRow0 = await loadKey("login", "email", email);
      const emRow = emRow0 ? await resetIfWindowExpired(emRow0) : null;
      const emCount = (emRow?.count ?? 0) + 1;
      const emLocked =
        emCount >= MAX_ATTEMPTS ? new Date(t + LOCKOUT_MS) : null;
      await (prisma as any).authThrottle.update({
        where: { id: emRow.id },
        data: { count: emCount, lockedUntil: emLocked },
      });
    }
  } catch (e) {
    memFail({ kind: "login", ip, email: email ?? undefined } as any);
  }
}

export async function recordLoginSuccessDb(params: {
  ip?: string | null;
  email?: string | null;
}) {
  const ip = (params.ip ?? "unknown").trim() || "unknown";
  const email = params.email ? normEmail(params.email) : null;
  const t = now();

  try {
    const ipRow0 = await loadKey("login", "ip", ip);
    await (prisma as any).authThrottle.update({
      where: { id: ipRow0.id },
      data: { count: 0, lockedUntil: null, resetAt: new Date(t + WINDOW_MS) },
    });

    if (email) {
      const emRow0 = await loadKey("login", "email", email);
      await (prisma as any).authThrottle.update({
        where: { id: emRow0.id },
        data: { count: 0, lockedUntil: null, resetAt: new Date(t + WINDOW_MS) },
      });
    }
  } catch (e) {
    memOk({ kind: "login", ip, email: email ?? undefined } as any);
  }
}
