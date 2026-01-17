import fs from "fs";
import path from "path";
import { cfg } from "@/lib/config";

export const runtime = "nodejs";

const FORBIDDEN_PREFIXES = [
  "/api/e2e/",
  "/api/debug/",
];

export async function register() {
  // Never run outside prod
  if (cfg.env !== "production") return;

  // Absolute kill switch
  if (cfg.raw("NODE_ENV") !== "production") return;

  const manifestPath = path.join(
    process.cwd(),
    ".next/server/app-paths-manifest.json"
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      "[SECURITY] Missing app-paths-manifest.json in production build"
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  ) as Record<string, unknown>;

  const routes = Object.keys(manifest);

  const violations = routes.filter((route) =>
    FORBIDDEN_PREFIXES.some((prefix) =>
      route.startsWith(prefix)
    )
  );

  if (violations.length > 0) {
    console.error("[SECURITY] Forbidden routes detected in production:");
    for (const r of violations) console.error(" -", r);
    throw new Error("Forbidden routes present in production build");
  }
}
