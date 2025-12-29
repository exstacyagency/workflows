// scripts/bootstrap.ts
import "dotenv/config";

import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

function env(name: string, required = false): string {
  const v = (process.env[name] ?? "").trim();
  if (required && !v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function run(cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...(opts?.env ?? {}) },
  });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
  }
}

async function main() {
  // ---- Required ----
  env("DATABASE_URL", true);

  // ---- Admin seed inputs ----
  const adminEmailRaw = env("BOOTSTRAP_ADMIN_EMAIL", true);
  const adminEmail = normalizeEmail(adminEmailRaw);

  const adminPassword = env("BOOTSTRAP_ADMIN_PASSWORD", true);
  if (adminPassword.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");
  }

  // ---- Optional project seed ----
  const seedProject = env("BOOTSTRAP_SEED_PROJECT") === "1";
  const projectId = env("BOOTSTRAP_PROJECT_ID") || "proj_bootstrap";
  const projectName = env("BOOTSTRAP_PROJECT_NAME") || "Bootstrap Project";
  const projectDescription = env("BOOTSTRAP_PROJECT_DESCRIPTION") || "Seeded by scripts/bootstrap.ts";

  console.log("[bootstrap] Running prisma migrate deploy...");
  run("npx", ["prisma", "migrate", "deploy"]);

  console.log("[bootstrap] Seeding admin user...");
  const prisma = new PrismaClient();

  try {
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash },
      create: {
        email: adminEmail,
        passwordHash,
        name: adminEmail.split("@")[0],
      },
      select: { id: true, email: true },
    });

    console.log(`[bootstrap] Admin user ready: ${user.email}`);

    if (seedProject) {
      console.log("[bootstrap] Seeding project...");
      await prisma.project.upsert({
        where: { id: projectId },
        update: {
          name: projectName,
          description: projectDescription,
          userId: user.id,
        },
        create: {
          id: projectId,
          name: projectName,
          description: projectDescription,
          userId: user.id,
        },
        select: { id: true },
      });

      console.log(`[bootstrap] Project ready: ${projectId}`);
    } else {
      console.log("[bootstrap] Project seed skipped (set BOOTSTRAP_SEED_PROJECT=1 to enable).");
    }

    console.log("[bootstrap] Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[bootstrap] FAILED:", e?.message ?? e);
  process.exit(1);
});
