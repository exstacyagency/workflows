import { prisma } from "@/lib/db";

export async function getJobForUser({
  jobId,
  userId,
}: {
  jobId: string;
  userId: string;
}) {
  return prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
    },
  });
}
