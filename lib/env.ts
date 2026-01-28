// eslint-disable-next-line no-restricted-properties
// lib/env.ts
export const env = {
  // eslint-disable-next-line no-restricted-properties
  NODE_ENV: process.env.NODE_ENV ?? "development",
  // eslint-disable-next-line no-restricted-properties
  MODE: process.env.MODE ?? "dev",
};
