import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

/**
 * HARD RULES
 * - Must never run in production
 * - Must bypass auth & middleware
 * - Must be explicit and dumb
 */


export async function POST() {
  // Hard kill in production
  if (cfg().isProd) {
    return new NextResponse(null, { status: 404 });
  }

  // Explicitly require e2e / golden context
  if (!cfg().securitySweep && !cfg().isGolden) {
    return new NextResponse(null, { status: 404 });
  }

  await prisma.$transaction([
    prisma.job.deleteMany(),
    prisma.project.deleteMany(),
  ]);

  return NextResponse.json({ ok: true });
}