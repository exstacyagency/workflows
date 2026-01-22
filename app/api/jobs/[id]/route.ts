import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function GET(_req, { params }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let job = null;
  try {
    job = await prisma.job.findFirst({
      where: { id: params.id, project: { userId } },
      select: {
        id: true,
        status: true,
        currentStep: true,
        resultSummary: true,
        error: true,
        failureCode: true,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
