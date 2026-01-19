import { assertRuntimeMode } from './src/runtime/assertMode.ts';

const MODE = assertRuntimeMode();
if (MODE === 'alpha' && process.env.NODE_ENV === 'production') {
	throw new Error('INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production');
}

console.log(`[BOOT] Runtime mode: ${MODE}`);
if (MODE === 'alpha') {
	console.log('[PIPELINE] Running in ALPHA mode');
}

async function startWorkers() {
	await import('./lib/workers/customerResearchWorker');
	console.log('[Workers] All workers initialized');
}

startWorkers().catch((err) => {
	console.error('[Workers] Failed to start', err);
	process.exit(1);
});
