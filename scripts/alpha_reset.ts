import { prisma } from "@/lib/prisma";

function assertSafeRuntime() {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Refusing to run alpha_reset in production.");
	}
}

async function reset() {
	assertSafeRuntime();
	await prisma.job.deleteMany({});
	await prisma.project.deleteMany({});
	console.log("[alpha] state reset complete");
}

reset().catch((err) => {
	console.error("[alpha] state reset failed", err);
	process.exitCode = 1;
});
