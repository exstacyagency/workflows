import { ResearchArtifacts } from "./contracts/research";
import { PatternBrainArtifacts } from "./patternBrain/types";

export type PipelineArtifacts = {
  research?: ResearchArtifacts;
  patterns?: unknown;
  patternBrain?: PatternBrainArtifacts;
  character?: unknown;
  script?: unknown;
  videoPrompts?: unknown;
  storyboard?: unknown;
  editedVideo?: unknown;
  finalOutput?: unknown;
};

export type PipelineStep =
  | "research"
  | "pattern_brain"
  | "character"
  | "script"
  | "video_prompts"
  | "storyboard"
  | "final";
