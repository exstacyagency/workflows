import { cfg } from "@/lib/config";
import { RUNTIME_MODE, type RuntimeMode } from "../../config/runtime";

export function assertRuntimeMode(): RuntimeMode {
	const mode = cfg.RUNTIME_MODE ?? null;

	if (!mode) {
		throw new Error("RUNTIME MODE MISSING: You must start the app with MODE=alpha | beta | prod");
	}

	if (!(RUNTIME_MODE as readonly string[]).includes(mode)) {
		throw new Error(`Invalid MODE: ${mode}`);
	}

	if (mode === "alpha") {
		if (cfg.raw("NODE_ENV") !== "production") {
			throw new Error("Alpha must run with NODE_ENV=production");
		}
	}

	return mode as RuntimeMode;
import { RUNTIME_MODE, type RuntimeMode } from "@/config/runtime";

function isBuildTime(): boolean {
  return cfg.raw("NEXT_PHASE") === "phase-production-build";
}

export function assertRuntimeMode(): RuntimeMode {
  const mode = cfg.runtimeMode ?? cfg.MODE ?? null;

  if (!mode) {
    if (isBuildTime()) {
      return "alpha";
    }
    throw new Error("RUNTIME MODE MISSING: You must start the app with MODE=alpha | beta | prod");
  }

  if (!(RUNTIME_MODE as readonly string[]).includes(mode)) {
    if (mode === "alpha") return "alpha";
    throw new Error(`INVALID RUNTIME MODE: ${mode}`);
  }

  return mode as RuntimeMode;
}
