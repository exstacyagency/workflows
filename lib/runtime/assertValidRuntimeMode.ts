export function assertValidRuntimeMode(mode: string) {
  if (mode !== "alpha" && mode !== "dev" && mode !== "production") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }
}
