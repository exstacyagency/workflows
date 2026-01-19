/**
 * Single authoritative runtime switches.
 * Do not read process.env directly outside this file.
 */

export const RUNTIME_MODE = {
	alpha: "alpha",
	beta: "beta",
	prod: "prod",
	dev: "dev",
} as const;

export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];

export const CURRENT_RUNTIME_MODE =
	(process.env.MODE as RuntimeMode | undefined) ?? RUNTIME_MODE.prod;

// Alpha is enabled when any of these signals are present. SECURITY_SWEEP covers deterministic runs.
export const IS_ALPHA =
	process.env.ALPHA_MODE === "true" ||
	CURRENT_RUNTIME_MODE === RUNTIME_MODE.alpha ||
	process.env.SECURITY_SWEEP === "1";
