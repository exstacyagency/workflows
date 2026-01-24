import { assertNotAlpha } from '@/lib/runtimeGuard';
import '@/lib/env';
import '@/lib/flags';

export function register() {
  try {
    assertNotAlpha();
  } catch (err) {
    console.error(err);
    process.exit(1); // REQUIRED: Next will not do this for you
  }
}
