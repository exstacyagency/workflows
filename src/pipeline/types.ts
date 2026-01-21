import { ResearchArtifacts } from "./contracts/research";

export type PipelineArtifacts = {
  research?: ResearchArtifacts;
  patterns?: unknown;
  character?: unknown;
  script?: unknown;
  videoPrompts?: unknown;
  storyboard?: unknown;
  editedVideo?: unknown;
  finalOutput?: unknown;
};
