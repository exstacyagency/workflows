import { NextRequest } from "next/server";
import { cfg } from "@/lib/config";

export function isAdminRequest(req: NextRequest): boolean {
  const expected = (cfg.raw("DEBUG_ADMIN_TOKEN") ?? "").trim();
  if (!expected) return false;

  const headerToken = (req.headers.get("x-debug-admin-token") ?? "").trim();
  const queryToken =
    cfg.raw("NODE_ENV") === "production"
      ? ""
      : (new URL(req.url).searchParams.get("token") ?? "").trim();
  const got = headerToken || queryToken;

  return got === expected;
}
