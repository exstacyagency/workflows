import { cfg } from "@/lib/config";
export type PlanId = "FREE" | "GROWTH" | "SCALE";

export function getPriceIdForPlan(planId: "GROWTH" | "SCALE"): string {
  if (planId === "GROWTH") {
    const v = cfg().raw("STRIPE_PRICE_GROWTH")?.trim();
    if (!v) throw new Error("Missing STRIPE_PRICE_GROWTH");
    return v;
  }

  const v = cfg().raw("STRIPE_PRICE_SCALE")?.trim();
  if (!v) throw new Error("Missing STRIPE_PRICE_SCALE");
  return v;
}

export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "FREE";

  const growthPriceId = cfg().raw("STRIPE_PRICE_GROWTH")?.trim();
  if (growthPriceId && priceId === growthPriceId) return "GROWTH";

  const scalePriceId = cfg().raw("STRIPE_PRICE_SCALE")?.trim();
  if (scalePriceId && priceId === scalePriceId) return "SCALE";

  return "FREE";
}
