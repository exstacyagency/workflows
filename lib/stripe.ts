import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey || secretKey.trim().length === 0) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const apiVersion = process.env.STRIPE_API_VERSION?.trim();

export const stripe = new Stripe(
  secretKey,
  apiVersion ? { apiVersion: apiVersion as any } : {}
);

