import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  void req;
  return NextResponse.json(
    { error: "Audio swap has been removed from this application." },
    { status: 410 },
  );
}
