import { cfg } from '@/lib/config/runtime';

const isBuildTime =
  cfg().NEXT_PHASE === 'phase-production-build';

if (!isBuildTime) {
  const c = cfg();

  if (c.NODE_ENV === 'production' && c.MODE !== 'beta') {
    throw new Error('Production runtime must run in MODE=beta');
  }
}
