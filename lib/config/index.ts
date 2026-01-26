// eslint-disable-next-line no-restricted-properties

import { cfg as runtimeCfg } from "./runtime";
export const cfg = {
	// eslint-disable-next-line no-restricted-properties
	env: process.env.NODE_ENV ?? "development",
	// eslint-disable-next-line no-restricted-properties
	runtimeMode: process.env.RUNTIME_MODE ?? "beta",
	...runtimeCfg,
};
export * from "./flags";
