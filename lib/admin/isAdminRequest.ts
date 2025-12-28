import { NextRequest } from "next/server";
import { cfg } from "@/lib/config";

export function isAdminRequest(req: NextRequest): boolean {
  const expected = (cfg.raw("DEBUG_ADMIN_TOKEN") ?? "").trim();
  if (!expected) return false;

  const got =
    (req.headers.get("x-debug-admin-token") ?? "").trim() ||
    (new URL(req.url).searchParams.get("token") ?? "").trim();

  return got === expected;
}
