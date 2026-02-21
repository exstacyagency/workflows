import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "CHARACTER_CAMEO creation is not implemented yet",
      message: "Use the Sora character pipeline integration to enable this endpoint.",
    },
    { status: 501 },
  );
}
