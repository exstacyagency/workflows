import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    spaceBotWsUrl: process.env.SPACEBOT_WS_URL ?? "ws://localhost:18789/webchat",
  })
}
