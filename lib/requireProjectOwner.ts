import { prisma } from "@/lib/prisma";
import { getSessionUser } from "./getSessionUser";

export async function requireProjectOwner(projectId: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });

  if (!project) return { error: "Forbidden", status: 403 };

  return { user };
}
