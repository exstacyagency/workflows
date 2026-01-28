
// Inline getRuntimeMode logic (must be JS, not TS)
function getRuntimeMode() {
	const nodeEnv = process.env.NODE_ENV;
	const explicitMode = process.env.MODE;
	if (nodeEnv === "production") {
		if (explicitMode === "prod" || explicitMode === "beta") {
			return explicitMode;
		}
		return "beta";
	}
	return explicitMode === "prod" || explicitMode === "beta"
		? explicitMode
		: "dev";
}
const runtimeMode = getRuntimeMode();
if (process.env.NODE_ENV === "production" && runtimeMode === "dev") {
	throw new Error("🚨 Production runtime resolved to dev — this is a fatal error");
}
console.log(`[BOOT] Runtime mode: ${runtimeMode}`);

async function startWorkers() {
	await import('./lib/workers/customerResearchWorker');
	console.log('[Workers] All workers initialized');
}

startWorkers().catch((err) => {
	console.error('[Workers] Failed to start', err);
	process.exit(1);
});
