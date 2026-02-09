import { NextRequest, NextResponse } from "next/server";
import { ResearchSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { extractTextFromFile } from "@/services/fileUploadService";

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
    const file = formData.get("file");
    const jobIdValue = formData.get("jobId");

    if (!(file instanceof File) || typeof jobIdValue !== "string" || !jobIdValue.trim()) {
      return NextResponse.json({ error: "File and jobId required" }, { status: 400 });
    }

    const jobId = jobIdValue.trim();
    const extractedRows = await extractTextFromFile(file, file.type);
    const uploadedAt = new Date().toISOString();

    const rows = extractedRows.map((row, idx) => ({
      projectId,
      jobId,
      source: ResearchSource.LOCAL_BUSINESS,
      type: "UPLOADED",
      content: row.text,
      metadata: {
        filename: file.name,
        uploadedAt,
        chunkIndex: idx + 1,
        uploadSource: "USER_UPLOAD",
        source: row.source ?? "UPLOADED",
        date: row.date ?? null,
        ...(row.metadata ?? {}),
      },
    }));

    if (rows.length > 0) {
      await prisma.researchRow.createMany({ data: rows });
    }

    return NextResponse.json({
      success: true,
      rowsAdded: rows.length,
      filename: file.name,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
