import { NextRequest, NextResponse } from "next/server";
import { ssePublish } from "@/lib/notifications/ssePublisher";
import type { JobCompletionPayload } from "@/lib/notifications/notifyAll";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload: JobCompletionPayload = await req.json();
  await ssePublish(payload.projectId, payload);

  return NextResponse.json({ ok: true });
}
