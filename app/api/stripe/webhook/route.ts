import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { getStripe } from "@/lib/stripe";
import { planFromPriceId } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

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

function getStripePriceIdFromSubscription(sub: Stripe.Subscription): string | null {
  const item0: any = (sub as any).items?.data?.[0];
  const price: any = item0?.price;
  if (price && typeof price === "object" && typeof price.id === "string") return price.id;
  if (typeof price === "string") return price;
  return null;
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

async function recordBillingEvent(args: {
  stripeEventId: string;
  type: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  userId?: string | null;
  payload: unknown;
}) {
  try {
    await prisma.billingEvent.create({
      data: {
        stripeEventId: args.stripeEventId,
        type: args.type,
        stripeCustomerId: args.stripeCustomerId ?? null,
        stripeSubscriptionId: args.stripeSubscriptionId ?? null,
        userId: args.userId ?? null,
        payloadJson: args.payload as Prisma.InputJsonValue,
      },
    });
    return { inserted: true };
  } catch (e) {
    // idempotency: if we already processed this Stripe event, return OK
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { inserted: false };
    }
    throw e;
  }
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

  const payload = JSON.parse(rawBody);
  const payloadObject: any = (payload as any)?.data?.object;
  const stripeCustomerId =
    typeof payloadObject?.customer === "string" ? payloadObject.customer : null;
  const stripeSubscriptionId = event.type.startsWith("customer.subscription.")
    ? typeof payloadObject?.id === "string"
      ? payloadObject.id
      : null
    : typeof payloadObject?.subscription === "string"
      ? payloadObject.subscription
      : null;

  try {
    await recordBillingEvent({
      stripeEventId: event.id,
      type: event.type,
      stripeCustomerId,
      stripeSubscriptionId,
      userId: null,
      payload: event,
    });
  } catch (err) {
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
