import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RouteEntry = { method: string; route: string; file: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && ent.name === "route.ts") out.push(p);
  }
  return out;
}

function routeFromPath(file: string): string {
  // app/api/<...>/route.ts => /api/<...>
  const norm = file.split(path.sep).join("/");
  const idx = norm.indexOf("app/api/");
  const sub = idx >= 0 ? norm.slice(idx + "app/api/".length) : norm;
  const without = sub.replace(/\/route\.ts$/, "");
  return "/api/" + without;
}

function detectMethods(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const methods: string[] = [];
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${m}\\b`);
    if (re.test(src)) methods.push(m);
  }
  return methods.length ? methods : ["(unknown)"];
}

export function buildRouteInventory(): RouteEntry[] {
  const root = path.join(process.cwd(), "app", "api");
  if (!fs.existsSync(root)) return [];
  const files = walk(root);
  const entries: RouteEntry[] = [];
  for (const f of files) {
    const route = routeFromPath(f);
    for (const m of detectMethods(f)) {
      entries.push({ method: m, route, file: f });
    }
  }
  entries.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method));
  return entries;
}

function isMain(): boolean {
  // ESM-safe "main module" detection
  const thisFile = fileURLToPath(import.meta.url);
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === path.resolve(thisFile);
}

if (isMain()) {
  const entries = buildRouteInventory();
  const lines = entries.map((e) => `${e.method}\t${e.route}\t${e.file}`);
  process.stdout.write(lines.join("\n") + "\n");
}
