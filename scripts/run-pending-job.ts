import { prisma } from "@/lib/prisma";
import { executePipeline } from "@/src/pipeline/executor";

async function run() {
  const job = await prisma.job.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    console.log("No pending jobs");
    return;
  }

  console.log("Running job:", job.id);
  await executePipeline(job);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
