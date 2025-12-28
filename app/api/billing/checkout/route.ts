import { cfg } from "@/lib/config";
import { isSelfHosted } from "@/lib/config/mode";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { getStripe } from "@/lib/stripe";
import { getPriceIdForPlan } from "@/lib/billing/plans";

export async function POST(req: NextRequest) {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const planId =
    typeof body === "object" &&
    body !== null &&
    "planId" in body &&
    typeof (body as any).planId === "string"
      ? ((body as any).planId as string)
      : null;

  if (planId !== "GROWTH" && planId !== "SCALE") {
    return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
  }

  const appUrl = cfg.raw("APP_URL")?.trim();
  if (!appUrl) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 500 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let stripe;
  let priceId: string;
  try {
    stripe = getStripe();
    priceId = getPriceIdForPlan(planId);
  } catch (err) {
    console.error("Stripe config error", err);
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 500 }
    );
  }

  try {
    const existing = await prisma.$queryRaw<
      { stripeCustomerId: string | null }[]
    >`
      SELECT "stripeCustomerId"
      FROM "User"
      WHERE id = ${user.id}
      LIMIT 1
    `;
    let customerId = existing[0]?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;

      await prisma.$executeRaw`
        UPDATE "User"
        SET "stripeCustomerId" = ${customerId}
        WHERE id = ${user.id}
      `;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing/cancel`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Billing provider error" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("Stripe checkout error", err);
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 500 }
    );
  }
}
