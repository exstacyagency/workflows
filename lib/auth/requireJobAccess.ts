
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";

export async function requireJobAccess(jobId: string, userId: string) {
  const mode = cfg.RUNTIME_MODE || cfg.MODE || cfg.mode || cfg.env || "dev";
  const isTestMode = ["test", "dev", "beta", "alpha"].includes(mode);
  const securitySweep = cfg.raw && cfg.raw("SECURITY_SWEEP") === "1";
  if (isTestMode || securitySweep) {
    // Only allow access if userId is user_test AND email is test@local.dev
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.email !== "test@local.dev" || userId !== "user_test") {
      throw new Error("NOT_FOUND");
    }
  }
  const job = await db.job.findFirst({
    where: {
      id: jobId,
      userId,
    },
  });
  if (!job) throw new Error("NOT_FOUND");
  return job;
}
