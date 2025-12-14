import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3001";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function run() {
  console.log("Starting prod server:", BASE_URL);

  const server = spawn("npm", ["run", "start"], {
    env: { ...process.env, NODE_ENV: "production", PORT },
    stdio: "inherit",
  });

  const up = await waitForHealth();
  if (!up) {
    server.kill("SIGKILL");
    throw new Error("Server failed health check");
  }

  console.log("Running attacker sweep...");
  const sweep = spawn("node", ["scripts/attacker_sweep.mjs"], {
    env: { ...process.env, BASE_URL },
    stdio: "inherit",
  });

  const code = await new Promise((resolve) => sweep.on("close", resolve));

  server.kill("SIGKILL");

  if (code !== 0) {
    throw new Error(`Attacker sweep failed with code ${code}`);
  }

  console.log("✅ prod smoke passed");
}

run().catch((e) => {
  console.error("❌ prod smoke failed:", e?.message ?? e);
  process.exit(1);
});

