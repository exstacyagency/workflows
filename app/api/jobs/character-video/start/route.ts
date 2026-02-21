import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "CHARACTER_REFERENCE_VIDEO generation is not implemented yet",
      message: "Use the Sora character pipeline integration to enable this endpoint.",
    },
    { status: 501 },
  );
}
