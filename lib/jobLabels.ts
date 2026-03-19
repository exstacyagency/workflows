export const JOB_TYPE_LABELS = {
  CUSTOMER_RESEARCH: "Customer Collection",
  CUSTOMER_ANALYSIS: "Customer Analysis",
  AD_PERFORMANCE: "Ad Collection",
  AD_QUALITY_GATE: "Quality Assessment",
  PATTERN_ANALYSIS: "Ad Analysis",
  PRODUCT_DATA_COLLECTION: "Product Collection",
  PRODUCT_ANALYSIS: "Product Analysis",
  SCRIPT_GENERATION: "Script Generation",
  STORYBOARD_GENERATION: "Storyboard Generation",
  VIDEO_PROMPT_GENERATION: "Video Prompt Generation",
  VIDEO_IMAGE_GENERATION: "First Frame Generation",
  VIDEO_GENERATION: "Video Generation",
  VIDEO_REVIEW: "Video Edit",
  VIDEO_UPSCALER: "Video Upscale",
  MERGE_NEXT: "Merge Scenes",
  IMAGE_PROMPT_GENERATION: "Image Prompt Generation",
  CREATOR_AVATAR_GENERATION: "Avatar Generation",
  CHARACTER_SEED_VIDEO: "Character Seed Video",
  CHARACTER_REFERENCE_VIDEO: "Character Reference Video",
  CHARACTER_VOICE_SETUP: "Character Voice Setup",
} as const;

export function getJobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type as keyof typeof JOB_TYPE_LABELS] || type;
}
