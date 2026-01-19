import { prisma } from "@/lib/prisma";

async function reset() {
	await prisma.job.deleteMany({});
	await prisma.project.deleteMany({});
	console.log("[alpha] state reset complete");
}

reset().catch((err) => {
	console.error("[alpha] state reset failed", err);
	process.exitCode = 1;
});
