import { cfg } from "@/lib/config";
import Stripe from "stripe";

let cachedStripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (cachedStripe) return cachedStripe;

  const secretKey = cfg().raw("STRIPE_SECRET_KEY");
  if (!secretKey || secretKey.trim().length === 0) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const apiVersion = cfg().raw("STRIPE_API_VERSION")?.trim();
  cachedStripe = new Stripe(
    secretKey,
    apiVersion ? { apiVersion: apiVersion as any } : {}
  );
  return cachedStripe;
}
