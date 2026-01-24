export type RuntimeMode = "dev" | "beta" | "prod";

export function getRuntimeMode(): RuntimeMode {
  if (cfg.MODE === "prod" || cfg.MODE === "beta" || cfg.MODE === "dev") {
    return cfg.MODE;
  }
  return "dev";
}

export function assertRuntimeModeAllowed() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const mode = getRuntimeMode();
  if (cfg.NODE_ENV === "production" && mode === "dev") {
    throw new Error("Production build must run in MODE=beta or MODE=prod");
  }
}
