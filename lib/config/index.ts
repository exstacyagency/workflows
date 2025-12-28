/* eslint-disable no-restricted-properties */
export const cfg = {
  raw(name: string): string | undefined {
    switch (name) {
      case "NODE_ENV":
        return process.env.NODE_ENV;
      case "CI":
        return process.env.CI;
      default:
        return process.env[name];
    }
  },
};

