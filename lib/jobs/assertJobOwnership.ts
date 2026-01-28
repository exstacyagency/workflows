import { prisma } from "@/lib/db";

export async function assertJobOwnership({
  jobId,
  userId,
}: {
  jobId: string;
  userId: string;
}) {
  return prisma.job.findUnique({
    where: {
      id_userId: {
        id: jobId,
        userId,
      },
    },
  });
}
