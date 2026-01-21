export type ResearchArtifacts = {
  customerInsights: string[];
  productInsights: string[];
  adInsights: string[];
};

export type PatternBrainArtifacts = {
  topPatterns: {
    category: "customer" | "product" | "ad";
    pattern: string;
    confidence: number;
  }[];
  generatedAt: string;
};
