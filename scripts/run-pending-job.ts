import { prisma } from "@/lib/prisma";
import { processJob } from "@/lib/internal/jobRunner";

async function main() {
  const pendingJob = await prisma.job.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });

  if (!pendingJob) {
    console.log("No pending jobs found");
    return;
  }

  await processJob(pendingJob.id);
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
