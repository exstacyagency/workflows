import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { getAdDataCompleteness } from "@/lib/patternAnalysisService";

type Params = {
  params: {
    projectId: string;
  };
};

export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  try {
    const runId = req.nextUrl.searchParams.get("runId");
    const completeness = await getAdDataCompleteness({
      projectId,
      runId: runId || undefined,
    });
    return NextResponse.json({ success: true, completeness });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to compute ad data completeness" },
      { status: 500 }
    );
  }
}
