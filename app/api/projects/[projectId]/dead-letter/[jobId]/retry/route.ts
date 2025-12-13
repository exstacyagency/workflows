import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/getSessionUser";
import { requireProjectOwner } from "@/lib/requireProjectOwner";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  const user = await getSessionUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, jobId } = params;
  const auth = await requireProjectOwner(projectId);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const job = await prisma.job.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, payload: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload: any = job.payload ?? {};
  payload.dismissed = false;
  payload.nextRunAt = Date.now() - 1000;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      error: null,
      payload,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

