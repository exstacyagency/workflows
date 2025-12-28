/* eslint-disable no-restricted-properties */
import fs from "node:fs";
import path from "node:path";

export type DotenvLoadOptions = {
  /**
   * If false (default), existing process.env keys are preserved.
   * If true, values in the file will overwrite existing process.env keys.
   */
  overwrite?: boolean;
};

export function loadDotEnvFileIfPresent(
  filename: string,
  opts: DotenvLoadOptions = {}
) {
  const filePath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    let key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (!key) continue;

    const exists = process.env[key] !== undefined;
    if (exists && !opts.overwrite) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

