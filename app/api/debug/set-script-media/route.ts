import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/getSessionUser";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  // Dev-only guard
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const scriptId = typeof body?.scriptId === "string" ? body.scriptId : "";
  const field = typeof body?.field === "string" ? body.field : "";
  const key = typeof body?.key === "string" ? body.key : "";

  if (!scriptId || !key || !["mergedVideoUrl", "upscaledVideoUrl"].includes(field)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    include: { project: true },
  });

  if (!script) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (script.project.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.script.update({
    where: { id: scriptId },
    data: { [field]: key } as any,
    select: { id: true, mergedVideoUrl: true, upscaledVideoUrl: true, projectId: true },
  });

  return NextResponse.json({ ok: true, script: updated }, { status: 200 });
}

