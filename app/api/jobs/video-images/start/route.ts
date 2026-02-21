import { NextResponse } from "next/server";

export async function POST(req: Request) {
  return NextResponse.json(
    {
      error: "VIDEO_IMAGE_GENERATION is deprecated",
      message: "This job type has been archived. Use Sora 2 Character Cameos for direct video generation instead.",
      deprecatedAt: "2026-02-21",
    },
    { status: 410 },
  );
}
