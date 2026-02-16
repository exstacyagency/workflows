// lib/externalCallGuard.ts
type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export class TimeoutError extends Error {
  constructor(message = "Timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  console.log("[externalCallGuard] withTimeout apply", {
    label,
    timeoutMs: ms,
  });
  let t: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  isRetryable: (err: any) => boolean
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 1 + opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt >= 1 + opts.retries || !isRetryable(err)) {
        break;
      }
      await sleep(computeDelay(attempt, opts.baseDelayMs, opts.maxDelayMs));
    }
  }
  throw lastErr;
}

type BreakerState = {
  failures: number;
  openedUntil: number;
};

const breakerMap = new Map<string, BreakerState>();

export type CircuitBreakerOptions = {
  failureThreshold: number;
  cooldownMs: number;
};

export function isBreakerOpen(key: string) {
  const st = breakerMap.get(key);
  if (!st) return false;
  if (st.openedUntil === 0) return false;
  if (Date.now() >= st.openedUntil) {
    breakerMap.set(key, { failures: 0, openedUntil: 0 });
    return false;
  }
  return true;
}

function recordFailure(key: string, opts: CircuitBreakerOptions) {
  const st = breakerMap.get(key) ?? { failures: 0, openedUntil: 0 };
  const failures = st.failures + 1;

  if (failures >= opts.failureThreshold) {
    breakerMap.set(key, { failures, openedUntil: Date.now() + opts.cooldownMs });
  } else {
    breakerMap.set(key, { failures, openedUntil: 0 });
  }
}

function recordSuccess(key: string) {
  breakerMap.set(key, { failures: 0, openedUntil: 0 });
}

export async function guardedExternalCall<T>(params: {
  breakerKey: string;
  breaker: CircuitBreakerOptions;
  timeoutMs: number;
  retry: RetryOptions;
  label: string;
  fn: () => Promise<T>;
  isRetryable: (err: any) => boolean;
}): Promise<T> {
  const { breakerKey, breaker, timeoutMs, retry, label, fn, isRetryable } = params;

  if (isBreakerOpen(breakerKey)) {
    throw new Error(`${label} blocked: circuit breaker open`);
  }

  try {
    const result = await withRetries(
      () => {
        console.log("[externalCallGuard] guardedExternalCall received timeout", {
          label,
          breakerKey,
          timeoutMs,
        });
        return withTimeout(fn(), timeoutMs, label);
      },
      retry,
      isRetryable
    );
    recordSuccess(breakerKey);
    return result;
  } catch (err) {
    recordFailure(breakerKey, breaker);
    throw err;
  }
}
