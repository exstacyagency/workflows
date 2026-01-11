import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSelfHosted } from "@/lib/config/mode";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function POST(req: Request) {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { scriptId, field, key } = body as {
    scriptId?: string;
    field?: string;
    key?: string;
  };

  if (!scriptId || !field || !key) {
    return NextResponse.json(
      { error: "Missing scriptId, field, or key" },
      { status: 400 }
    );
  }

  // ⚠️ Only allow known safe fields to be updated
  const ALLOWED_FIELDS = new Set([
    "videoUrl",
    "imageUrl",
  ]);

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Field '${field}' is not allowed` },
      { status: 400 }
    );
  }

  const updated = await prisma.script.update({
    where: { id: scriptId },
    data: { [field]: key },
    select: {
      id: true,
      projectId: true,
    },
  });

  return NextResponse.json(
    { ok: true, script: updated },
    { status: 200 }
  );
}