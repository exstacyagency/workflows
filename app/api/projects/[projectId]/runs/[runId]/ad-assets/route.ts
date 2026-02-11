import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { prisma } from "@/lib/prisma";

type Params = {
  params: {
    projectId: string;
    runId: string;
  };
};

export async function GET(_request: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(params.projectId || "").trim();
  const runId = String(params.runId || "").trim();

  if (!projectId || !runId) {
    return NextResponse.json({ error: "projectId and runId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  try {
    const assets = await prisma.adAsset.findMany({
      where: {
        projectId,
        job: {
          is: {
            runId,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        jobId: true,
        platform: true,
        createdAt: true,
        updatedAt: true,
        retention_3s: true,
        retention_10s: true,
        retention_3s_ctr: true,
        retention_10s_ctr: true,
        retention_3s_cvr: true,
        retention_10s_cvr: true,
        duration: true,
        source_type: true,
        engagement_score: true,
        rawJson: true,
      },
    });

    return NextResponse.json({
      success: true,
      projectId,
      runId,
      count: assets.length,
      assets,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load ad assets" },
      { status: 500 },
    );
  }
}
