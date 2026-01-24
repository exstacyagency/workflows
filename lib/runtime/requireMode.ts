// lib/runtime/requireMode.ts
import { cfg } from "../config/runtime";
export function requireRuntimeMode() {
  if (process.env.NODE_ENV !== "production") return;

  const mode = process.env.MODE;

  if (!mode) {
    throw new Error("MODE must be explicitly set in production");
  }

  if (mode !== "beta" && mode !== "prod") {
    throw new Error("Production build must run in MODE=beta or MODE=prod");
  }
}
