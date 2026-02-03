import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ResearchSource } from "@prisma/client";
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
  const deny = await requireProjectOwner404(projectId);
  if (deny) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const jobId = formData.get("jobId") as string | null;

    if (!file || !jobId) {
      return NextResponse.json({ error: "File and jobId required" }, { status: 400 });
    }

    const filename = file.name || "upload";
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const researchSourceValues = new Set(Object.values(ResearchSource));

    const resolveSourceLabel = (value?: string | null) => {
      if (value && value.trim()) return value.trim();
      if (ext === "txt") return filename;
      return "UPLOADED";
    };

    const toResearchSource = (label?: string | null) => {
      if (!label) return ResearchSource.LOCAL_BUSINESS;
      const trimmed = label.trim();
      if (!trimmed) return ResearchSource.LOCAL_BUSINESS;
      const upper = trimmed.toUpperCase();
      if (researchSourceValues.has(upper as ResearchSource)) {
        return upper as ResearchSource;
      }
      if (researchSourceValues.has(trimmed as ResearchSource)) {
        return trimmed as ResearchSource;
      }
      return ResearchSource.LOCAL_BUSINESS;
    };

    const extractedRows = await extractTextFromFile(file, file.type);

    const rows = extractedRows.map((row, idx) => {
      const sourceLabel = resolveSourceLabel(row.source);
      return {
        projectId,
        jobId,
        source: toResearchSource(sourceLabel),
        type: "UPLOADED",
        content: row.text,
        metadata: {
          filename,
          uploadedAt: new Date().toISOString(),
          chunkIndex: idx + 1,
          uploadSource: "USER_UPLOAD",
          source: sourceLabel,
          date: row.date ?? null,
          ...(row.metadata ?? {}),
        },
      };
    });

    if (rows.length > 0) {
      await prisma.researchRow.createMany({
        data: rows,
      });
    }

    return NextResponse.json({
      success: true,
      rowsAdded: rows.length,
      filename: file.name,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
