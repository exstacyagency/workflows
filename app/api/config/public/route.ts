import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    openClawWsUrl: process.env.OPENCLAW_WS_URL ?? null,
    openClawGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? null,
  })
}
