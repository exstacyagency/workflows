import { ResearchArtifacts } from "../contracts/research";

export async function runResearch(): Promise<ResearchArtifacts> {
  return {
    customer: {
      demographics: {},
      pains: [],
      desires: [],
      objections: [],
    },
    product: {
      valueProps: [],
      features: [],
      differentiators: [],
    },
    ads: {
      hooks: [],
      claims: [],
      emotionalTriggers: [],
      ctas: [],
    },
  };
}
