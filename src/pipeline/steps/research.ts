import { ResearchArtifacts } from "../contracts/research";

type ResearchInput = {
  jobId: string;
  projectId: string;
  payload: unknown;
};

export async function runResearch(
  _input: ResearchInput,
): Promise<ResearchArtifacts> {
  // Deterministic stub — NO providers, NO randomness
  return {
    generatedAt: new Date().toISOString(),
    mode: "stub",
    insights: [
      {
        category: "customer",
        title: "Target customer profile",
        facts: [
          "Customer is cost-sensitive",
          "Customer prefers short-form video ads",
          "Customer responds to clear value propositions",
        ],
        sources: [
          {
            type: "customer",
            source: "stub.payload",
            confidence: 0.3,
          },
        ],
      },
      {
        category: "product",
        title: "Core product attributes",
        facts: [
          "Product reduces time to outcome",
          "Product is positioned as easy to use",
        ],
        sources: [
          {
            type: "product",
            source: "stub.project",
            confidence: 0.3,
          },
        ],
      },
      {
        category: "ad",
        title: "Ad market observations",
        facts: [
          "High-performing ads use hooks in first 3 seconds",
          "Simple language outperforms technical language",
        ],
        sources: [
          {
            type: "market",
            source: "stub.market",
            confidence: 0.2,
          },
        ],
      },
    ],
  };
}
