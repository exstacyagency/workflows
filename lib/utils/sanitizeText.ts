export function stripHtml(input: string): string {
  // Defensive: strip script/style blocks iteratively, then strip tags.
  // Iteration avoids edge cases where a first pass exposes additional tag fragments.
  let current = String(input ?? "");
  for (let i = 0; i < 5; i++) {
    const prev = current;
    current = current
      // <script ...> ... </script ...>
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
      // <style ...> ... </style ...>
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, "")
      // If any raw "<script" or "<style" fragments remain, drop them too.
      .replace(/<\s*script\b[^>]*>/gi, "")
      .replace(/<\s*style\b[^>]*>/gi, "");
    if (current === prev) break;
  }

  return current
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(input: string, max = 320): string {
  const s = String(input ?? "");
  if (s.length <= max) return s;
  const suffix = "...";
  if (max <= suffix.length) return s.slice(0, max);
  return s.slice(0, max - suffix.length) + suffix;
}

/**
 * Returns a debug-safe text snippet for logs/UI.
 * It is NOT HTML. We escape characters so "<script>" cannot be interpreted as markup.
 */
export function toSafeTextSnippet(input: string, max = 320): string {
  const s = String(input ?? "");

  // Escape to prevent any HTML interpretation if this is later rendered in UI.
  const escaped = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();

  return truncate(escaped, max);
}
