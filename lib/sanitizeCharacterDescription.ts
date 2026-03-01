// Avatar-template prompts must never enter scene character descriptions.
// These phrases are valid for avatar sheet generation but harmful for scene prompts.
export const AVATAR_TEMPLATE_LINE_BLOCKLIST = [
  "full-body character reference image",
  "plain white or transparent background",
  "character reference image",
  "transparent background",
  "full body shot",
  "full-body shot",
  "full length",
  "studio background",
  "white seamless",
  "neutral background",
  "seamless background",
  "white background",
  "plain background",
  "no environment",
  "no props",
  "no furniture",
  "head to toe",
  "requirements:",
  "natural, relaxed pose",
  "arms at sides",
  "smartphone selfie realism",
];

export function sanitizeCharacterDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .split(/\r?\n/)
    .filter((line) => {
      const lower = String(line ?? "").toLowerCase().trim();
      if (!lower) return false;
      return !AVATAR_TEMPLATE_LINE_BLOCKLIST.some((marker) => lower.includes(marker));
    })
    .join("\n")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
