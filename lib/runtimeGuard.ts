import { cfg } from '@/lib/config';

export function assertNotAlpha() {
  if (cfg.MODE === 'beta' && cfg.raw('ALPHA_ONLY') === '1') {
    throw new Error('Alpha-only code executed in beta mode');
  }
}
