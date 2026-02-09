import { NextRequest, NextResponse } from "next/server";
import { Prisma, ResearchSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const jobId = formData.get("jobId") as string | null;

    if (!(file instanceof File) || typeof jobId !== "string" || !jobId.trim()) {
      return NextResponse.json({ error: "File and jobId required" }, { status: 400 });
    }

    const filename = file.name;
    const text = await file.text();
    const lines = text.split("\n");

    const chunks = lines.map((line) => line.trim()).filter(Boolean);

    const rows: Prisma.ResearchRowCreateManyInput[] = chunks.map((chunk, idx) => ({
      projectId,
      jobId,
      source: ResearchSource.UPLOADED,
      type: "upload",
      content: chunk,
      metadata: {},
    }));

    if (rows.length > 0) {
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
