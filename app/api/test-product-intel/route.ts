import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { extractProductIntel } from "@/lib/productIntelService";

export const runtime = "nodejs";

const DEFAULT_TEST_URL = "https://clearstem.com/products/mindbodyskin-csb";

export async function GET(req: NextRequest) {
  if (cfg.raw("NODE_ENV") === "production" || cfg.raw("DISABLE_DEV_ADMIN") === "true") {
    return new NextResponse(null, { status: 404 });
  }

  const url = req.nextUrl.searchParams.get("url") || DEFAULT_TEST_URL;

  try {
    console.log("[Test Product Intel] Running extraction for URL:", url);
    const startedAt = Date.now();
    const result = await extractProductIntel(url);
    const durationMs = Date.now() - startedAt;

    return NextResponse.json(
      {
        ok: true,
        url,
        durationMs,
        result: {
          ...result,
          raw_html: result.raw_html ? `[${result.raw_html.length} chars captured]` : null,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        url,
        error: String(error?.message ?? error),
      },
      { status: 500 },
    );
  }
}
