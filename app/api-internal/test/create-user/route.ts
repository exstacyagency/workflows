import { NextResponse } from "next/server";
import { createTestUser } from "@/lib/test/createTestUser";
import { cfg } from "@/lib/config";

export async function POST(req: Request) {
  // Only allow in beta mode
  if (cfg.mode !== "beta") {
    return NextResponse.json(
      { error: "Test user creation endpoint is only available in beta mode." },
      { status: 403 }
    );
  }
  try {
    const { email } = await req.json();
    const { token, projectId } = await createTestUser(email);
    return NextResponse.json({ token, projectId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
