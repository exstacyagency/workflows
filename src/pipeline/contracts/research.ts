export type ResearchSource = {
  type: "customer" | "product" | "market";
  source: string;
  confidence: number;
};

export type ResearchInsight = {
  category: "customer" | "product" | "ad";
  title: string;
  facts: string[];
  sources: ResearchSource[];
};

export type ResearchArtifacts = {
  generatedAt: string;
  mode: "stub";
  insights: ResearchInsight[];
};
