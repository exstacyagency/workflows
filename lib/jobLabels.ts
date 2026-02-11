export const JOB_TYPE_LABELS = {
  CUSTOMER_RESEARCH: "Customer Collection",
  CUSTOMER_ANALYSIS: "Customer Analysis",
  AD_PERFORMANCE: "Ad Collection",
  AD_QUALITY_GATE: "Quality Assessment",
  PATTERN_ANALYSIS: "Ad Analysis",
  PRODUCT_DATA_COLLECTION: "Product Collection",
  PRODUCT_ANALYSIS: "Product Analysis",
} as const;

export function getJobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type as keyof typeof JOB_TYPE_LABELS] || type;
}
