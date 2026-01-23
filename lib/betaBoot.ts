import { assertNotAlpha } from '@/lib/runtimeGuard';

import { cfg } from '@/lib/config/runtime';

const isBuildTime =
  cfg().NEXT_PHASE === 'phase-production-build';

export function betaBootCheck() {
  if (isBuildTime) return;
  assertNotAlpha();
}
