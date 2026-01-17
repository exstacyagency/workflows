import { NextResponse } from "next/server";

/**
 * HARD RULES
 * - Must never run in production
 * - Must bypass auth & middleware
 * - Must be explicit and dumb
 */

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // existing dev / e2e logic below
  // DO NOT add prod-only imports here

  // === RESET LOGIC ===
  // Intentionally minimal and explicit
  // Example:
  // await prisma.$transaction([
  //   prisma.job.deleteMany(),
  //   prisma.project.deleteMany(),
  // ]);

  return NextResponse.json({ ok: true });
}