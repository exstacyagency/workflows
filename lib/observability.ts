import type { NextRequest } from "next/server";

export function getRequestId(req: NextRequest): string {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-request-id".toUpperCase()) ||
    "unknown"
  );
}

export function logInfo(event: string, ctx: Record<string, any> = {}) {
  console.log(
    JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...ctx })
  );
}

export function logError(event: string, err: any, ctx: Record<string, any> = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ts: new Date().toISOString(),
      error: String(err?.message ?? err),
      ...ctx,
    })
  );
}

