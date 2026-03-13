import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  void req;
  return NextResponse.json(
    { error: "Voice generation has been removed from this application." },
    { status: 410 },
  );
}
