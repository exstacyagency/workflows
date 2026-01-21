import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { advanceJobState } from "@/src/jobs/advanceJobState";

async function main() {
  const pendingJob = await prisma.job.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });

  if (!pendingJob) {
    console.log("No pending jobs found");
    return;
  }

  let currentStep: string | null = null;

  await advanceJobState(pendingJob.id, JobStatus.RUNNING, {
    currentStep: "boot",
  });
  currentStep = "boot";

  try {
    await prisma.job.update({
      where: { id: pendingJob.id },
      data: { currentStep: "execute_pipeline" },
    });
    currentStep = "execute_pipeline";

    // pipeline execution placeholder
    // runPipeline(job.payload)

    await prisma.job.update({
      where: { id: pendingJob.id },
      data: { currentStep: null },
    });
    currentStep = null;

    await advanceJobState(pendingJob.id, JobStatus.COMPLETED);
  } catch (err) {
    await advanceJobState(pendingJob.id, JobStatus.FAILED, {
      currentStep,
      error: String(err),
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
