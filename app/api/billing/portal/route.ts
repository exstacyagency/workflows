import { NextResponse } from "next/server";
import { isSelfHosted } from "@/lib/config/mode";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { getStripe } from "@/lib/stripe";

export async function POST() {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<
    { stripeCustomerId: string | null }[]
  >`
    SELECT "stripeCustomerId"
    FROM "User"
    WHERE id = ${userId}
    LIMIT 1
  `;
  const stripeCustomerId = rows[0]?.stripeCustomerId ?? null;
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Billing customer not found" }, { status: 400 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    console.error("Stripe config error", err);
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 500 }
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("Stripe billing portal error", err);
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 500 }
    );
  }
}
