export const SORA_CLIP_LENGTHS = [10, 15] as const;
export type SoraClipLength = (typeof SORA_CLIP_LENGTHS)[number];

export const WORDS_PER_CLIP: Record<SoraClipLength, number> = {
  10: 22,
  15: 32,
};

export function beatsForClipDuration(
  targetDuration: number,
  clipDuration: SoraClipLength,
): number {
  return Math.round(targetDuration / clipDuration);
}
