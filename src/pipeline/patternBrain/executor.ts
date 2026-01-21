import { ResearchArtifacts, PatternBrainArtifacts } from "./types";

/**
 * Pattern Brain executor
 * - Deterministic
 * - No external providers
 * - Pure function
 */
export async function runPatternBrain(
  research: ResearchArtifacts,
): Promise<PatternBrainArtifacts> {
  const patterns: PatternBrainArtifacts["topPatterns"] = [];

  for (const insight of research.customerInsights) {
    patterns.push({
      category: "customer",
      pattern: `Customers respond strongly to: ${insight}`,
      confidence: 0.7,
    });
  }

  for (const insight of research.productInsights) {
    patterns.push({
      category: "product",
      pattern: `Product strength detected: ${insight}`,
      confidence: 0.75,
    });
  }

  for (const insight of research.adInsights) {
    patterns.push({
      category: "ad",
      pattern: `High-performing ad theme: ${insight}`,
      confidence: 0.8,
    });
  }

  return {
    topPatterns: patterns.slice(0, 10),
    generatedAt: new Date().toISOString(),
  };
}
