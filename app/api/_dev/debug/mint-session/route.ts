import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { isSelfHosted } from "@/lib/config/mode";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function POST() {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // SECURITY: secret must exist, but we never expose it
  const secret =
    cfg().raw("AUTH_SECRET") ||
    cfg().raw("NEXTAUTH_SECRET");

  if (!secret) {
    return NextResponse.json(
      { error: "Auth secret not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      userId,
      issuedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}
