export const RUNTIME_MODE = ["alpha", "beta", "prod"] as const;

export type RuntimeMode = (typeof RUNTIME_MODE)[number];

export function getRuntimeModeFromEnv(): RuntimeMode | null {
	const m = process.env.MODE;
	if (!m) return null;
	if ((RUNTIME_MODE as readonly string[]).includes(m)) {
		return m as RuntimeMode;
	}
	return null;
}

export const CURRENT_RUNTIME_MODE = getRuntimeModeFromEnv();

// Alpha is enabled when any of these signals are present. SECURITY_SWEEP covers deterministic runs.
export const IS_ALPHA =
	process.env.ALPHA_MODE === "true" ||
	CURRENT_RUNTIME_MODE === "alpha" ||
	process.env.SECURITY_SWEEP === "1";
