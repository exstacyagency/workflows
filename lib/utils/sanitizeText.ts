export function stripHtml(input: string): string {
  // very defensive; handles huge HTML blobs
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
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
