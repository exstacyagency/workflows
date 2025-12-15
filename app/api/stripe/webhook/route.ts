import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { planFromPriceId } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function getStripeCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const c: any = (sub as any).customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof c.id === "string") return c.id;
  return null;
}

function getStripeCustomerIdFromSession(session: Stripe.Checkout.Session): string | null {
  const c: any = (session as any).customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof c.id === "string") return c.id;
  return null;
}

function getStripePriceIdFromSubscription(sub: Stripe.Subscription): string | null {
  const item0: any = (sub as any).items?.data?.[0];
  const price: any = item0?.price;
  if (price && typeof price === "object" && typeof price.id === "string") return price.id;
  if (typeof price === "string") return price;
  return null;
}

async function findUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "User"
    WHERE "stripeCustomerId" = ${stripeCustomerId}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function ensureUserHasStripeCustomerId(userId: string, stripeCustomerId: string) {
  await prisma.$executeRaw`
    UPDATE "User"
    SET "stripeCustomerId" = ${stripeCustomerId}
    WHERE id = ${userId}
      AND ("stripeCustomerId" IS NULL OR "stripeCustomerId" = '')
  `;
}

async function upsertUserSubscription(params: {
  userId: string;
  planId: "FREE" | "GROWTH" | "SCALE";
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}) {
  const existing = await prisma.subscription.findFirst({
    where: { userId: params.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const data: any = {
    planId: params.planId,
    status: params.status,
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripePriceId: params.stripePriceId,
    currentPeriodEnd: params.currentPeriodEnd,
    cancelAtPeriodEnd: params.cancelAtPeriodEnd,
  };

  if (existing?.id) {
    await (prisma.subscription as any).update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
    return;
  }

  await (prisma.subscription as any).create({
    data: {
      userId: params.userId,
      ...data,
    },
    select: { id: true },
  });
}

async function handleSubscriptionEvent(sub: Stripe.Subscription, opts?: { deleted?: boolean }) {
  const stripeSubscriptionId = sub.id;
  const stripeCustomerId = getStripeCustomerIdFromSubscription(sub);
  if (!stripeCustomerId) {
    throw new Error("Missing Stripe customer id");
  }

  const stripePriceId = getStripePriceIdFromSubscription(sub);

  const metadataUserId = asString((sub as any)?.metadata?.userId);
  const userId = metadataUserId || (await findUserIdByStripeCustomerId(stripeCustomerId));
  if (!userId) {
    // Nothing to sync; acknowledge webhook to avoid retries.
    return;
  }

  await ensureUserHasStripeCustomerId(userId, stripeCustomerId);

  const status = String((sub as any).status ?? "unknown");
  const cancelAtPeriodEnd = Boolean((sub as any).cancel_at_period_end);
  const currentPeriodEndSeconds = Number((sub as any).current_period_end ?? 0);
  const currentPeriodEnd =
    currentPeriodEndSeconds > 0 ? new Date(currentPeriodEndSeconds * 1000) : null;

  const planId: "FREE" | "GROWTH" | "SCALE" =
    opts?.deleted === true ? "FREE" : planFromPriceId(stripePriceId);

  await upsertUserSubscription({
    userId,
    planId,
    status,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    console.error("Stripe config error", err);
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription as any)?.id ?? null;

      if (!subscriptionId) {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      // Retrieve full subscription to read metadata/price details.
      const sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
      await handleSubscriptionEvent(sub);

      // Best-effort: ensure customer id is persisted on user when possible.
      const stripeCustomerId = getStripeCustomerIdFromSession(session);
      const userId = asString((sub as any)?.metadata?.userId);
      if (stripeCustomerId && userId) {
        await ensureUserHasStripeCustomerId(userId, stripeCustomerId);
      }
    }

    if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub);
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub, { deleted: true });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("Stripe webhook handler failed", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

