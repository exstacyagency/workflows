import { cfg } from '@/lib/config/runtime';

export function assertNotAlpha() {
  const c = cfg();

  if (c.MODE === 'beta' && c.ALPHA_ONLY === '1') {
    throw new Error('Alpha-only code executed in beta mode');
  }
}
