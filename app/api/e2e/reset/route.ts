import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";

/**
 * HARD RULES
 * - Must never run in production
 * - Must bypass auth & middleware
 * - Must be explicit and dumb
 */

export async function POST(request: Request) {
  // Absolute kill switch — prod must look like it does not exist
  if (cfg.env === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Secondary hard guard (defense in depth)
  if (cfg.raw("NODE_ENV") === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Shared-secret guard (local / CI only)
  const expected = cfg.raw("E2E_RESET_KEY");
  if (expected) {
    const key = request.headers.get("x-e2e-reset-key");
    if (key !== expected) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  // === RESET LOGIC ===
  // Intentionally minimal and explicit
  // Example:
  // await prisma.$transaction([
  //   prisma.job.deleteMany(),
  //   prisma.project.deleteMany(),
  // ]);

  return NextResponse.json({ ok: true });
}