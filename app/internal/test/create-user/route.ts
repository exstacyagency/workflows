import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import prisma from "@/lib/prisma";


// beta-only test hook (security sweep)
export async function POST(req: NextRequest) {
  if (cfg.mode !== "beta") {
    // Hard-fail if not beta mode
    return NextResponse.json({ error: "Test user creation endpoint is only available in beta mode." }, { status: 403 });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    // Upsert user deterministically
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    // Silent on success
    return new Response(null, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
