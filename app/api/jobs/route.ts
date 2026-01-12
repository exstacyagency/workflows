import { NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";

type JobPayload = {
  campaignId?: unknown;
  projectId?: unknown;
  type?: unknown;
};

export async function POST(req: Request) {
  let body: JobPayload;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = req.headers.get("x-user-email");
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { account: true },
  });

  if (!user || !user.account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const type = typeof body.type === "string" ? body.type : "";

  if (!campaignId || !projectId || !type) {
    return NextResponse.json(
      { error: "campaignId, projectId, and type are required" },
      { status: 400 },
    );
  }

  const jobType = Object.values(JobType).includes(type as JobType) ? (type as JobType) : null;
  if (!jobType) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });

    if (!campaign || campaign.accountId !== user.account.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (campaign.state !== "ACTIVE") {
      return NextResponse.json({ error: "Campaign must be ACTIVE" }, { status: 403 });
    }

    await assertEntitled(user.account.id, `job.${jobType.toLowerCase()}`);

    const job = await prisma.job.create({
      data: {
        projectId,
        type: jobType,
        status: JobStatus.PENDING,
      },
    });

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
