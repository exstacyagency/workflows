import { cfg } from "@/lib/config";

export type RuntimeMode = "alpha" | "beta" | "prod" | "dev";

const ALLOWED_MODES: RuntimeMode[] = ["alpha", "beta", "prod", "dev"];

export function getRuntimeMode(): RuntimeMode {
  const mode = cfg().raw("MODE") as RuntimeMode | undefined;

  if (!mode) {
    throw new Error(
      "RUNTIME MODE MISSING: You must start the app with MODE=alpha | beta | prod | dev"
    );
  }

  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error(
      `INVALID RUNTIME MODE: "${mode}". Allowed values: ${ALLOWED_MODES.join(", ")}`
    );
  }

  return mode;
}
