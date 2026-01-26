
export function getRuntimeMode(): "alpha" | "dev" | "production" {
  if (process.env.NODE_ENV === "test") return "dev";
  if (process.env.NODE_ENV === "development") return "dev";

  const mode = process.env.RUNTIME_MODE;

  if (mode === "alpha" || mode === "dev" || mode === "production") {
    return mode;
  }

  return "dev";
}
