import { PrismaClient, JobStatus } from "@prisma/client";

const prisma = new PrismaClient();

const POLL_INTERVAL_MS = 3000;

async function pickAndRunJob() {
  // 1. Find one pending job (no lock)
  const job = await prisma.job.findFirst({
    where: { status: JobStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return null;
  }

  // 2. Atomically claim it
  const claimed = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: JobStatus.PENDING,
    },
    data: {
      status: JobStatus.RUNNING,
    },
  });

  if (claimed.count !== 1) {
    console.log(`⚠️  Job ${job.id} already claimed by another worker`);
    return null;
  }

  return job;
}

async function runJob(jobId: string) {
  try {
    console.log(`▶ Running job ${jobId}`);

    // Simulate work
    await new Promise((r) => setTimeout(r, 2000));

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: "Job completed successfully",
      },
    });

    console.log(`✅ Job ${jobId} succeeded`);
  } catch (error) {
    console.error(`❌ Job ${jobId} failed`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(error),
      },
    });
  }
}

async function loop() {
  console.log("🧵 Job worker started");

  while (true) {
    const job = await pickAndRunJob();

    if (job) {
      await runJob(job.id);
    } else {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

loop().catch((err) => {
  console.error("Worker crashed", err);
  process.exit(1);
});
