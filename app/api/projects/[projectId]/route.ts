import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string })?.id;
  const project = await db.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, userId: true, name: true, createdAt: true, updatedAt: true },
  });
  if (!project || !userId || project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(project, { status: 200 });
}
