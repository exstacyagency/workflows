import { NextResponse } from "next/server";

export async function POST(req: Request) {
  return NextResponse.json(
    {
      error: "IMAGE_PROMPT_GENERATION is deprecated",
      message: "This job type has been archived. Use VIDEO_PROMPT_GENERATION with Sora 2 Character Cameos instead.",
      deprecatedAt: "2026-02-21",
    },
    { status: 410 },
  );
}
