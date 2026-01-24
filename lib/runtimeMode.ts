export type RuntimeMode = "dev" | "beta" | "prod";

export function getRuntimeMode(): RuntimeMode {
  const mode =
    process.env.MODE === "prod" ||
    process.env.MODE === "beta" ||
    process.env.MODE === "dev"
      ? process.env.MODE
      : "dev";

  return mode;
}

export function assertRuntimeModeAllowed() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const mode = getRuntimeMode();

  if (process.env.NODE_ENV === "production" && mode === "dev") {
    throw new Error("Production build must run in MODE=beta or MODE=prod");
  }
}
