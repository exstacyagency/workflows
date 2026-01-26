
import { db } from "@/lib/db";


export async function requireJobAccess(jobId: string, userId: string) {
  const job = await db.job.findFirst({
    where: {
      id: jobId,
      userId, // 🔒 HARD OWNER CHECK
    },
  });

    if (!job) throw new Error("NOT_FOUND");

  return job;
}
