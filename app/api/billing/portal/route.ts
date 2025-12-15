import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { stripe } from "@/lib/stripe";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 500 });
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

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("Stripe billing portal error", err);
    return NextResponse.json({ error: "Billing provider error" }, { status: 500 });
  }
}
