export * from "./config/flags";
import { cfg } from '@/lib/config';

const alphaFlags = [
  'ENABLE_ALPHA_PIPELINE',
  'ALPHA_GUARD_DISABLED',
] as const;

if (cfg.MODE === 'beta') {
  for (const flag of alphaFlags) {
    if (cfg.raw(flag) === '1') {
      throw new Error(`Alpha flag ${flag} enabled in beta`);
    }
  }
}
