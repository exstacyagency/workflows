export type CustomerResearch = {
  demographics: {
    ageRange?: string;
    gender?: string;
    location?: string;
  };
  pains: string[];
  desires: string[];
  objections: string[];
};

export type ProductResearch = {
  valueProps: string[];
  features: string[];
  differentiators: string[];
};

export type AdResearch = {
  hooks: string[];
  claims: string[];
  emotionalTriggers: string[];
  ctas: string[];
};

export type ResearchArtifacts = {
  customer: CustomerResearch;
  product: ProductResearch;
  ads: AdResearch;
};
