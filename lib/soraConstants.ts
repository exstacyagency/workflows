export const SORA_CLIP_LENGTHS = [8] as const;
export type SoraClipLength = (typeof SORA_CLIP_LENGTHS)[number];

export const WORDS_PER_CLIP: Record<SoraClipLength, number> = {
  8: 18,
};

export function beatsForClipDuration(
  targetDuration: number,
  clipDuration: SoraClipLength,
): number {
  return Math.round(targetDuration / clipDuration);
}
