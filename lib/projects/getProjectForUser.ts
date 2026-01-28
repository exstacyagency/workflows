import { prisma } from "@/lib/db";

export async function getProjectForUser({
  projectId,
  userId,
  includeJobs = false,
}: {
  projectId: string;
  userId: string;
  includeJobs?: boolean;
}) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    include: includeJobs
      ? {
          jobs: {
            where: { userId },
          },
        }
      : undefined,
  });
}
