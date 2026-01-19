import { NextResponse } from "next/server";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";
import { isDev } from "@/lib/env";
import { assertRuntimeMode } from "@/src/runtime/assertMode";

type JobPayload = {
  campaignId?: unknown;
  projectId?: unknown;
  type?: unknown;
  idempotencyKey?: unknown;
};

function stableHash(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }
  const obj = input as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    ordered[key] = obj[key];
  }
  return JSON.stringify(ordered);
}

export async function POST(req: Request) {
  assertRuntimeMode();

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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let account = user.account;

  if (!account) {
    // Allow automatic account creation in alpha/dev to keep smoke tests simple.
    if (isDev() || cfg.RUNTIME_MODE === "alpha") {
      account = await prisma.account.create({
        data: {
          users: { connect: { id: user.id } },
        },
      });
    } else {
      return NextResponse.json({ error: "Account required" }, { status: 403 });
    }
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const type = typeof body.type === "string" ? body.type : "";
  const idempotencyKey =
    req.headers.get("idempotency-key") ??
    (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);

  if (!projectId || !type) {
    return NextResponse.json(
      { error: "projectId and type are required" },
      { status: 400 },
    );
  }

  const jobType = Object.values(JobType).includes(type as JobType) ? (type as JobType) : null;
  if (!jobType) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: user.id,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 403 },
      );
    }

    let campaign: { id: string; state: string } | null = null;

    if (campaignId) {
      campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          accountId: account.id,
        },
      });

      if (!campaign) {
        return NextResponse.json(
          { error: "Campaign not found or access denied" },
          { status: 403 },
        );
      }

      if (campaign.state !== "ACTIVE") {
        return NextResponse.json(
          { error: "Campaign must be ACTIVE" },
          { status: 403 },
        );
      }
    }

    const canonicalCampaignId = campaign?.id ?? null;
    const payloadHash = stableHash({
      campaignId: canonicalCampaignId,
      projectId,
      type: jobType,
    });

    await assertEntitled(account.id, `job.${jobType.toLowerCase()}`);

    if (idempotencyKey) {
      const existing = await prisma.job.findFirst({ where: { idempotencyKey, projectId } });

      if (existing) {
        const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
        const existingHash = stableHash({
          campaignId: existingPayload.campaignId ?? null,
          projectId: existing.projectId,
          type: existing.type,
        });

        if (existingHash !== payloadHash) {
          return NextResponse.json(
            { error: "Idempotency key reuse with different payload" },
            { status: 409 },
          );
        }

        return NextResponse.json(existing, { status: 200 });
      }
    }

    try {
      const job = await prisma.job.create({
        data: {
          projectId,
          type: jobType,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload: { campaignId: canonicalCampaignId, projectId, type: jobType },
        },
      });

      log("api.jobs.success", { jobId: job.id, mode: cfg.RUNTIME_MODE });
      return NextResponse.json(job, { status: 201 });
    } catch (err: any) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        idempotencyKey
      ) {
        const existing = await prisma.job.findFirst({ where: { idempotencyKey, projectId } });
        if (existing) {
          return NextResponse.json(existing, { status: 200 });
        }
      }
      throw err;
    }
  } catch (error) {
    logError("api.jobs.failure", error);
    const message = error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
