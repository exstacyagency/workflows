import { NextResponse } from "next/server";
import { isSelfHosted } from "@/lib/config/mode";

export async function POST() {
  // Debug-only endpoint.
  // Auth throttle storage is environment-specific and not guaranteed
  // to exist in all schemas, so this endpoint is a safe no-op.

  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      cleared: false,
      reason: "auth throttle table not present in this deployment",
    },
    { status: 200 }
  );
}