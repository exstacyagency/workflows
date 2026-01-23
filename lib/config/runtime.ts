/* eslint-disable no-restricted-properties */
// eslint-disable-next-line no-restricted-properties
export function cfg() {
  const NODE_ENV = process.env.NODE_ENV;
  const env = NODE_ENV ?? 'development';
  const securitySweep = process.env.SECURITY_SWEEP === '1';
  const isGolden = securitySweep;
  return {
    MODE: process.env.MODE,
    ALPHA_ONLY: process.env.ALPHA_ONLY,
    ENABLE_ALPHA_PIPELINE: process.env.ENABLE_ALPHA_PIPELINE,
    ALPHA_GUARD_DISABLED: process.env.ALPHA_GUARD_DISABLED,
    NODE_ENV,
    env,
    NEXT_PHASE: process.env.NEXT_PHASE,
    securitySweep,
    isProd: NODE_ENV === 'production',
    isGolden,
    isDev: NODE_ENV !== 'production',
    RUNTIME_MODE: process.env.MODE,
    raw(name: string): string | undefined {
      return process.env[name];
    },
  };
}
