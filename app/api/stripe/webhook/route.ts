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

function isPrismaDuplicateStripeEventId(err: unknown): boolean {
  const e: any = err as any;
  if (!e || typeof e !== "object") return false;
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes("stripeEventId");
  if (typeof target === "string") return target.includes("stripeEventId");
  return true;
}

function getStripeCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const c: any = (sub as any).customer;
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

function getStripeCustomerIdFromEventObject(obj: unknown): string | null {
  const o: any = obj as any;
  const c: any = o?.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof c.id === "string") return c.id;
  return null;
}

function getStripeSubscriptionIdFromEventObject(obj: unknown, eventType: string): string | null {
  const o: any = obj as any;

  if (eventType.startsWith("customer.subscription.") && typeof o?.id === "string") {
    return o.id;
  }
  if (o?.object === "subscription" && typeof o?.id === "string") {
    return o.id;
  }

  const sub: any = o?.subscription;
  if (typeof sub === "string") return sub;
  if (sub && typeof sub === "object" && typeof sub.id === "string") return sub.id;

  return null;
}

function getUserIdFromEventObject(obj: unknown, eventType: string): string | null {
  const o: any = obj as any;
  if (eventType === "checkout.session.completed") {
    return asString(o?.client_reference_id) || asString(o?.metadata?.userId);
  }
  return asString(o?.metadata?.userId);
}

async function findUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function findExistingUserId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user?.id ?? null;
}

async function ensureUserHasStripeCustomerId(userId: string, stripeCustomerId: string) {
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ stripeCustomerId: null }, { stripeCustomerId: "" }],
    },
    data: { stripeCustomerId },
  });
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
  await prisma.subscription.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      planId: params.planId as any,
      status: params.status,
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripePriceId: params.stripePriceId,
      currentPeriodEnd: params.currentPeriodEnd,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    },
    update: {
      planId: params.planId as any,
      status: params.status,
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripePriceId: params.stripePriceId,
      currentPeriodEnd: params.currentPeriodEnd,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    },
  });
}

async function handleSubscriptionEvent(
  sub: Stripe.Subscription,
  opts?: { deleted?: boolean; userIdHint?: string | null }
) {
  const stripeSubscriptionId = sub.id;
  const stripeCustomerId = getStripeCustomerIdFromSubscription(sub);
  if (!stripeCustomerId) {
    console.warn("[stripe.webhook] missing subscription.customer; skipping", {
      stripeSubscriptionId,
    });
    return;
  }

  const stripePriceId = getStripePriceIdFromSubscription(sub);

  const hintUserId = asString(opts?.userIdHint);
  const hintExists = hintUserId ? await findExistingUserId(hintUserId) : null;
  const metadataUserId = asString((sub as any)?.metadata?.userId);
  const metadataExists = metadataUserId ? await findExistingUserId(metadataUserId) : null;

  const userId =
    hintExists ||
    metadataExists ||
    (await findUserIdByStripeCustomerId(stripeCustomerId));
  if (!userId) {
    console.warn("[stripe.webhook] user not found; skipping", {
      stripeCustomerId,
      stripeSubscriptionId,
    });
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
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !sig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    console.error("Stripe config error", err);
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payloadJson = JSON.parse(rawBody);
  const eventObject: any = (event.data as any)?.object;
  const stripeCustomerId = getStripeCustomerIdFromEventObject(eventObject);
  const stripeSubscriptionId = getStripeSubscriptionIdFromEventObject(eventObject, event.type);
  const userId = getUserIdFromEventObject(eventObject, event.type);

  const billingEventModel = (prisma as any).billingEvent;
  if (!billingEventModel?.create) {
    console.error("[stripe.webhook] Prisma client is missing BillingEvent; did you run prisma generate?", {
      stripeEventId: event.id,
      type: event.type,
    });
    return NextResponse.json({ error: "Server is not configured" }, { status: 500 });
  }

  try {
    await billingEventModel.create({
      data: {
        stripeEventId: event.id,
        type: event.type,
        stripeCustomerId,
        stripeSubscriptionId,
        userId,
        payloadJson,
      },
    });
  } catch (err) {
    if (isPrismaDuplicateStripeEventId(err)) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    console.error("[stripe.webhook] failed to record BillingEvent", err, {
      stripeEventId: event.id,
      type: event.type,
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if ((session as any)?.mode !== "subscription") {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const userId =
        asString((session as any)?.client_reference_id) ||
        asString((session as any)?.metadata?.userId);
      if (!userId) {
        console.warn("[stripe.webhook] checkout.session.completed missing user id; skipping", {
          sessionId: session.id,
        });
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const subscriptionId =
        typeof (session as any)?.subscription === "string"
          ? (session as any).subscription
          : (session as any)?.subscription?.id ?? null;
      if (!subscriptionId) {
        console.warn("[stripe.webhook] checkout.session.completed missing subscription id; skipping", {
          sessionId: session.id,
          userId,
        });
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
      await handleSubscriptionEvent(sub, { userIdHint: userId });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(sub, { deleted: true });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("Stripe webhook handler failed", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
