export type PlanId = "FREE" | "GROWTH" | "SCALE";

const growthPriceId = process.env.STRIPE_PRICE_GROWTH?.trim();
const scalePriceId = process.env.STRIPE_PRICE_SCALE?.trim();

if (!growthPriceId) {
  throw new Error("Missing STRIPE_PRICE_GROWTH");
}
if (!scalePriceId) {
  throw new Error("Missing STRIPE_PRICE_SCALE");
}

export const PLAN_PRICE_IDS = {
  GROWTH: growthPriceId,
  SCALE: scalePriceId,
} as const;

export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "FREE";
  if (priceId === growthPriceId) return "GROWTH";
  if (priceId === scalePriceId) return "SCALE";
  return "FREE";
}

