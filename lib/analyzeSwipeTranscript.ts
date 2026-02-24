const TIKTOK_WORDS_PER_SECOND = 2.5;

export interface BeatRatio {
  label: string;
  startPct: number;
  endPct: number;
}

export interface SwipeAnalysis {
  estimatedDuration: number; // snapped to 15/30/45/60
  suggestedBeats: number;
  beatBreakdown: string[];
  beatRatios: BeatRatio[];
}

const BEAT_RATIOS: BeatRatio[] = [
  { label: "Hook", startPct: 0, endPct: 0.15 },
  { label: "Problem", startPct: 0.15, endPct: 0.45 },
  { label: "Product", startPct: 0.45, endPct: 0.8 },
  { label: "CTA", startPct: 0.8, endPct: 1 },
];

export function analyzeSwipeTranscript(transcript: string): SwipeAnalysis {
  if (!transcript || transcript.length < 10) {
    return { estimatedDuration: 30, suggestedBeats: 5, beatBreakdown: [], beatRatios: BEAT_RATIOS };
  }

  const words = transcript.trim().split(/\s+/).length;
  const rawSeconds = words / TIKTOK_WORDS_PER_SECOND;

  const estimatedDuration =
    rawSeconds <= 18 ? 15 :
    rawSeconds <= 37 ? 30 :
    rawSeconds <= 52 ? 45 : 60;

  const suggestedBeats =
    estimatedDuration === 15 ? 3 :
    estimatedDuration === 30 ? 5 :
    estimatedDuration === 45 ? 6 : 8;

  const beatBreakdown = inferBeatBreakdown(transcript, estimatedDuration);

  return { estimatedDuration, suggestedBeats, beatBreakdown, beatRatios: BEAT_RATIOS };
}

export function scaleBeatRatiosToduration(
  ratios: BeatRatio[],
  targetDuration: number
): string {
  return ratios
    .map((r) => {
      const start = Math.round(r.startPct * targetDuration);
      const end = Math.round(r.endPct * targetDuration);
      return `${r.label}: ${start}-${end}s (${Math.round((r.endPct - r.startPct) * 100)}%)`;
    })
    .join("\n");
}

function inferBeatBreakdown(transcript: string, duration: number): string[] {
  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  if (sentences.length === 0) return [];

  return BEAT_RATIOS.map((r, i) => {
    const start = Math.round(r.startPct * duration);
    const end = Math.round(r.endPct * duration);
    const snippet = i === 0 ? `: "${sentences[0]?.slice(0, 40)}..."` : "";
    return `${r.label} ${start}-${end}s${snippet}`;
  });
}
