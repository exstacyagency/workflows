// lib/runtime/requireMode.ts
import { cfg } from "../config/runtime";
export function requireRuntimeMode() {
  if (cfg.isProd) {
    if (!cfg.MODE) {
      throw new Error("MODE must be explicitly set in production");
    }
    if (!["beta", "prod"].includes(cfg.MODE)) {
      throw new Error("Invalid MODE for production");
    }
  }
}
