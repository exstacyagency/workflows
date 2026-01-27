// eslint-disable-next-line no-restricted-properties

import { cfg as runtimeCfg } from "./runtime";
export const cfg = {
	// Only spread runtimeCfg to avoid duplicate 'env' property
	...runtimeCfg,
};
export * from "./flags";
