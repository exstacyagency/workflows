import { cfg } from "./lib/config";
import { requireRuntimeMode } from "./lib/runtime/requireMode";

requireRuntimeMode();
const runtimeMode = cfg.MODE || cfg.mode || "dev";
console.log(`[BOOT] Runtime mode: ${runtimeMode}`);

async function startWorkers() {
	await import('./lib/workers/customerResearchWorker');
	await import('./lib/workers/customerAnalysisWorker');
	console.log('[Workers] All workers initialized');
}

startWorkers().catch((err) => {
	console.error('[Workers] Failed to start', err);
	process.exit(1);
});
