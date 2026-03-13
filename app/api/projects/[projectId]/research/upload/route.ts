import { NextRequest, NextResponse } from "next/server";
import { Prisma, ResearchSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const awaitedParams = await params;
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = awaitedParams;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const jobId = formData.get("jobId") as string | null;
    const sourceTagRaw = formData.get("source");
    const sourceTag =
      typeof sourceTagRaw === "string" && sourceTagRaw.trim().length > 0
        ? sourceTagRaw.trim()
        : "operator_upload";

    if (!(file instanceof File) || typeof jobId !== "string" || !jobId.trim()) {
      return NextResponse.json({ error: "File and jobId required" }, { status: 400 });
    }

    const normalizedJobId = jobId.trim();
    const job = await prisma.job.findFirst({
      where: {
        id: normalizedJobId,
        projectId,
      },
      select: { id: true },
    });
    if (!job) {
      return NextResponse.json({ error: "jobId not found for this project" }, { status: 400 });
    }

    const filename = file.name;
    const text = await file.text();
    const lines = text.split("\n");

    const chunks = lines.map((line) => line.trim()).filter(Boolean);

    const rows: Prisma.ResearchRowCreateManyInput[] = chunks.map((chunk, idx) => ({
      projectId,
      jobId: normalizedJobId,
      source: ResearchSource.UPLOADED,
      type: "upload",
      content: chunk,
      metadata: { source: sourceTag },
      updatedAt: new Date(),
    }));

    if (rows.length > 0) {
      // TODO(low): preserve richer source metadata if operators need to round-trip uploads instead of line-level chunks.
      await prisma.researchRow.createMany({ data: rows });
    }

    return NextResponse.json({
      success: true,
      rowsAdded: rows.length,
      filename,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
