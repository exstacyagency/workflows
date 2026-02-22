import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function requireProjectOwner(projectId: string) {
  const userId = await getSessionUserId();
  if (!userId) return { error: "Unauthorized", status: 401 };

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, userId: true },
  });

  if (!project) return { error: "Forbidden", status: 403 };

  return { user: { id: userId }, project };
}
