import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    agentId?: string;
    sessionId?: string;
    message?: string;
  } | null;

  const agentId = String(body?.agentId ?? "").trim();
  const sessionId = String(body?.sessionId ?? "").trim();
  const message = String(body?.message ?? "").trim();

  if (!agentId || !sessionId || !message) {
    return NextResponse.json({ error: "agentId, sessionId, message required" }, { status: 400 });
  }

  // eslint-disable-next-line no-restricted-properties
  const res = await fetch(`${process.env.SPACEBOT_BASE_URL}/api/webchat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      session_id: sessionId,
      sender_name: "user",
      message,
    }),
  });

  return new Response(null, { status: res.ok ? 200 : 502 });
}
