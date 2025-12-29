// lib/utils/debugSnippet.ts
export function truncate(input: string, max = 800): string {
  const s = String(input ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function toB64Snippet(input: string, maxRaw = 800): string {
  const raw = truncate(String(input ?? ""), maxRaw);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `b64:${b64}`;
}

export function fromB64Snippet(snippet: string): string {
  const s = String(snippet ?? "");
  if (!s.startsWith("b64:")) return s;
  try {
    return Buffer.from(s.slice(4), "base64").toString("utf8");
  } catch {
    return s;
  }
}
