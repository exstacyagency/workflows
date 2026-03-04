// ⚠️ IMPORTANT:
// Instrumentation runs BEFORE app runtime config.
// It must NEVER throw, even if env vars are missing.

export async function register() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const rawMode = process.env.MODE;
  // Resolve mode safely with NO throws
  const mode =
    nodeEnv === "production"
      ? rawMode === "prod" || rawMode === "beta"
        ? rawMode
        : "beta"
      : rawMode ?? "dev";
  console.log("[INSTRUMENTATION] Runtime mode:", mode);
  // Start the job worker in-process (Node.js runtime only)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    import("./workers/jobRunner")
      .then(() => {
        console.log("[INSTRUMENTATION] jobRunner loaded in-process");
      })
      .catch((err) => {
        console.error("[INSTRUMENTATION] Failed to load jobRunner:", err);
      });
  }
}
