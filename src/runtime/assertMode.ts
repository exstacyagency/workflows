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
}
