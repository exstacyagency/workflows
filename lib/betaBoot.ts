import { assertNotAlpha } from './runtimeGuard';
import './flags';
import './env';

export function betaBootCheck() {
  assertNotAlpha();
}
