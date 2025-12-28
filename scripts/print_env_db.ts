/* eslint-disable no-restricted-properties */
import "dotenv/config";

function redactDbUrl(u?: string) {
  if (!u) return "(missing)";
  try {
    const url = new URL(u);
    if (url.password) url.password = "REDACTED";
    return url.toString();
  } catch {
    // best-effort redaction for non-URL formats
    return u.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:REDACTED@");
  }
}

console.log("NODE_ENV:", process.env.NODE_ENV || "(unset)");
console.log("DATABASE_URL:", redactDbUrl(process.env.DATABASE_URL));
console.log("PWD:", process.cwd());
