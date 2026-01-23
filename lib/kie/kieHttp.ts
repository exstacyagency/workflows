import crypto from "crypto";
import { cfg } from "@/lib/config";

type HttpMethod = "GET" | "POST";

function mustEnv(name: string): string {
  const v = cfg().raw(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function mustPathEnv(name: string): string {
  const v = mustEnv(name).trim();
  if (!v.startsWith("/")) throw new Error(`${name} must start with "/"`);
  return v;
}

function redact(s: string) {
  if (!s) return s;
  // redact obvious keys/tokens in logs
  return s.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

export type KieHttpConfig = {
  baseUrl: string; // e.g. https://api.kie.ai (NOT the docs website)
  apiKey: string;
  timeoutMs?: number;
};

export type KieJobPaths = {
  createPath: string; // e.g. /api/v1/jobs/createTask
  statusPath: string; // e.g. /api/v1/jobs/recordInfo?taskId=
};

export class KieHttpError extends Error {
  status: number;
  bodyText: string;
  constructor(message: string, status: number, bodyText: string) {
    super(message);
    this.name = "KieHttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

export function kieConfigFromEnv(): KieHttpConfig {
  return {
    baseUrl: mustEnv("KIE_API_BASE_URL").replace(/\/+$/, ""),
    apiKey: mustEnv("KIE_API_KEY"),
    timeoutMs: cfg().raw("KIE_TIMEOUT_MS") ? Number(cfg().raw("KIE_TIMEOUT_MS")) : 60_000,
  };
}

// Generic KIE job endpoints (no model-specific env vars)
export function kieJobPathsFromEnv(): KieJobPaths {
  return {
    createPath: mustPathEnv("KIE_CREATE_PATH"),
    statusPath: mustPathEnv("KIE_STATUS_PATH"),
  };
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function kieRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: T | null; text: string }> {
  const cfg = kieConfigFromEnv();
  const url = `${cfg.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "X-Request-Id": crypto.randomUUID(),
    ...(extraHeaders ?? {}),
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const json = safeJsonParse(text);

    // If someone misconfigured baseUrl to the docs site, you'll usually get HTML.
    if (text && text.trim().startsWith("<!DOCTYPE html")) {
      throw new KieHttpError(
        "KIE returned HTML (wrong base URL). Set KIE_API_BASE_URL to the actual API host, not docs/marketing.",
        res.status,
        text.slice(0, 500),
      );
    }

    if (!res.ok) {
      throw new KieHttpError(
        `KIE request failed: ${method} ${path} => ${res.status}`,
        res.status,
        text.slice(0, 2000),
      );
    }

    return { status: res.status, json, text };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`KIE request timeout after ${cfg.timeoutMs}ms: ${method} ${path}`);
    }
    // ensure we don't leak auth
    const msg = typeof e?.message === "string" ? redact(e.message) : "KIE request failed";
    e.message = msg;
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
