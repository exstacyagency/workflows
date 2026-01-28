import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { db } from "@/lib/db";

type ProjectAccess = {
  userId: string;
  projectId: string;
};

export async function requireProjectAccess(
  _req: NextRequest,
  projectId?: string
): Promise<ProjectAccess | NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId, projectId: project.id };
}

// Renamed to avoid redeclaration error
export async function requireProjectAccessById(projectId: string, userId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    throw new Error("NOT_FOUND");
  }

  return project;
}
