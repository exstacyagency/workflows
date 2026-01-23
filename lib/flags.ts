export { flag, devNumber } from './config/flags';
import { cfg } from '@/lib/config/runtime';

const isBuildTime =
  cfg().NEXT_PHASE === 'phase-production-build';

if (!isBuildTime) {
  const c = cfg();

  if (c.MODE === 'beta') {
    const alphaFlags = [
      'ENABLE_ALPHA_PIPELINE',
      'ALPHA_GUARD_DISABLED',
    ] as const;

    for (const flag of alphaFlags) {
      if (c[flag] === '1') {
        throw new Error(`Alpha flag ${flag} enabled in beta`);
      }
    }
  }
}
