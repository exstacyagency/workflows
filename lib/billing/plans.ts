export type PlanId = "FREE" | "GROWTH" | "SCALE";

export function getPriceIdForPlan(planId: "GROWTH" | "SCALE"): string {
  if (planId === "GROWTH") {
    const v = process.env.STRIPE_PRICE_GROWTH?.trim();
    if (!v) throw new Error("Missing STRIPE_PRICE_GROWTH");
    return v;
  }

  const v = process.env.STRIPE_PRICE_SCALE?.trim();
  if (!v) throw new Error("Missing STRIPE_PRICE_SCALE");
  return v;
}

export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "FREE";

  const growthPriceId = process.env.STRIPE_PRICE_GROWTH?.trim();
  if (growthPriceId && priceId === growthPriceId) return "GROWTH";

  const scalePriceId = process.env.STRIPE_PRICE_SCALE?.trim();
  if (scalePriceId && priceId === scalePriceId) return "SCALE";

  return "FREE";
}
