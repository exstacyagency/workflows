import { ResearchArtifacts } from "./research";

/**
 * Pattern Brain analyzes research and extracts reusable,
 * high-performing marketing structures.
 *
 * This output must be:
 * - deterministic (given same research)
 * - provider-agnostic
 * - directly consumable by script + prompt generation
 */
export type PatternBrainArtifacts = {
  /**
   * High-level themes that consistently drive engagement or conversion.
   * Example: "status signaling", "time savings", "fear of missing out"
   */
  coreThemes: string[];

  /**
   * Common narrative or persuasion patterns found in winning ads.
   * Example: "problem → agitation → solution"
   */
  narrativePatterns: Array<{
    name: string;
    description: string;
  }>;

  /**
   * Hooks that repeatedly appear in strong-performing ads.
   * These are structural, not final copy.
   */
  hooks: Array<{
    type:
      | "curiosity"
      | "pain"
      | "benefit"
      | "social-proof"
      | "authority"
      | "urgency";
    description: string;
  }>;

  /**
   * Emotional drivers that should be emphasized in messaging.
   * Example: "relief", "confidence", "belonging"
   */
  emotionalDrivers: string[];

  /**
   * Key objections and the winning counter-patterns that address them.
   */
  objectionPatterns: Array<{
    objection: string;
    counterPattern: string;
  }>;

  /**
   * Recommended creative angles that combine multiple signals
   * (theme + hook + emotion).
   */
  winningAngles: Array<{
    angle: string;
    rationale: string;
  }>;
};

/**
 * Contract for Pattern Brain execution.
 * This must NEVER be called directly from API routes.
 */
export type PatternBrainExecutor = (
  research: ResearchArtifacts
) => Promise<PatternBrainArtifacts>;
