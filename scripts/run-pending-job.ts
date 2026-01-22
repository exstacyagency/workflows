import { prisma } from "@/lib/prisma";
import { executePipeline } from "@/src/pipeline/executor";

const RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function run() {
  await prisma.job.updateMany({
    where: {
      status: "RUNNING",
      updatedAt: {
        lt: new Date(Date.now() - RUNNING_TIMEOUT_MS),
      },
    },
    data: {
      status: "FAILED",
      error: "Worker timeout",
    },
  });

  const job = await prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!candidate) return null;

    const claimed = await tx.job.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
      },
    });

    if (claimed.count === 0) return null;

    return tx.job.findUnique({ where: { id: candidate.id } });
  });

  if (!job) {
    console.log("No pending jobs");
    process.exit(0);
  }

  console.log("Running job:", job.id);
  try {
    await executePipeline(job);
  } catch (err) {
    console.error("Worker crash", err);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
