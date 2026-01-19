/**
 * Single authoritative runtime switches.
 * Do not read process.env directly outside this file.
 */

export const IS_ALPHA = process.env.ALPHA_MODE === "true";

export const RUNTIME_MODE = process.env.MODE ?? "prod";
