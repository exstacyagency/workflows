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
  if (input.length <= max) return input;
  const suffix = "...";
  if (max <= suffix.length) return input.slice(0, max);
  return input.slice(0, max - suffix.length) + suffix;
}
