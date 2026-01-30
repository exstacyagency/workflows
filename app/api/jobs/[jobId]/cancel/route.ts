import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = params;

    // Verify job ownership
    const existingJob = await prisma.job.findFirst({
      where: {
        id: jobId,
        userId: userId,
      },
    });

    if (!existingJob) {
      return NextResponse.json(
        { error: "Job not found or access denied" },
        { status: 404 }
      );
    }

    // Only allow cancelling running or pending jobs
    if (existingJob.status !== "RUNNING" && existingJob.status !== "PENDING") {
      return NextResponse.json(
        { error: "Can only cancel running or pending jobs" },
        { status: 400 }
      );
    }

    // Update job to failed with cancellation message
    const job = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error: JSON.stringify({ message: "Cancelled by user" }),
      },
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Error cancelling job:", error);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 }
    );
  }
}
