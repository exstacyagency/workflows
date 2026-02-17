import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

type RunRow = {
  id: string;
  projectId: string;
  name: string | null;
  status: string;
  createdAt: Date;
  jobCount: number;
  latestJobType: string | null;
  latestJobStatus: string | null;
  runNumber: number;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pathProjectId = String(params.projectId || "").trim();
    if (!pathProjectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: pathProjectId,
        userId,
      },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const rows = await prisma.$queryRaw<RunRow[]>(
      Prisma.sql`
        WITH run_rows AS (
          SELECT
            rr."id",
            rr."projectId",
            rr."name",
            rr."status"::text AS "status",
            rr."createdAt",
            COUNT(j."id")::int AS "jobCount",
            lj."latestJobType",
            lj."latestJobStatus"
          FROM "research_run" rr
          LEFT JOIN "job" j
            ON j."runId" = rr."id"
            AND j."projectId" = rr."projectId"
          LEFT JOIN LATERAL (
            SELECT
              j2."type"::text AS "latestJobType",
              j2."status"::text AS "latestJobStatus"
            FROM "job" j2
            WHERE j2."runId" = rr."id"
              AND j2."projectId" = rr."projectId"
            ORDER BY j2."createdAt" DESC
            LIMIT 1
          ) lj ON TRUE
          WHERE rr."projectId" = ${pathProjectId}
          GROUP BY rr."id", rr."projectId", rr."name", rr."status", rr."createdAt", lj."latestJobType", lj."latestJobStatus"
        )
        SELECT
          rr.*,
          ROW_NUMBER() OVER (ORDER BY rr."createdAt" ASC, rr."id" ASC)::int AS "runNumber"
        FROM run_rows rr
        ORDER BY rr."createdAt" ASC, rr."id" ASC
      `,
    );

    return NextResponse.json({ success: true, runs: rows }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to fetch runs" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pathProjectId = String(params.projectId || "").trim();
    const body = await req.json().catch(() => ({}));
    const requestedRunId = String(body?.runId || "").trim();
    const bodyProjectId = String(body?.projectId || "").trim();

    if (!pathProjectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    if (bodyProjectId && bodyProjectId !== pathProjectId) {
      return NextResponse.json(
        { error: "projectId in body must match URL" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: pathProjectId,
        userId,
      },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let run;
    if (requestedRunId) {
      const existing = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
      });
      if (existing && existing.projectId !== pathProjectId) {
        return NextResponse.json(
          { error: "runId already exists for a different project" },
          { status: 409 }
        );
      }
      run =
        existing ??
        (await prisma.researchRun.create({
          data: {
            id: requestedRunId,
            projectId: pathProjectId,
            status: "IN_PROGRESS",
          },
        }));
    } else {
      run = await prisma.researchRun.create({
        data: {
          id: randomUUID(),
          projectId: pathProjectId,
          status: "IN_PROGRESS",
        },
      });
    }

    return NextResponse.json({ success: true, run }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create run" },
      { status: 500 }
    );
  }
}
