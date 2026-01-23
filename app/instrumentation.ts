import { assertNotAlpha } from '@/lib/runtimeGuard';
import '@/lib/env';
import '@/lib/flags';

export function register() {
  assertNotAlpha();
}
