export type RuntimeMode = "alpha" | "production";

export function getRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNTIME_MODE ?? "alpha";
  if (mode !== "alpha" && mode !== "production") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }
  return mode;
}
