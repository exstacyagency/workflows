import fs from "fs";
import path from "path";

const manifestPath = path.join(process.cwd(), ".next", "routes-manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error("❌ routes-manifest.json not found. Did you run next build?");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const forbidden = [
  /^\/api\/debug\//,
  /^\/api\/e2e\//,
];

const routes: string[] = [
  ...(manifest.dynamicRoutes ?? []).map((r: any) => r.page),
  ...(manifest.staticRoutes ?? []).map((r: any) => r.page),
];

const violations = routes.filter((route) =>
  forbidden.some((rx) => rx.test(route))
);

if (violations.length > 0) {
  console.error("❌ Forbidden routes present in production build:");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}

console.log("✅ Production route manifest clean");
