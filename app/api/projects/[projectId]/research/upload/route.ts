import { NextRequest, NextResponse } from "next/server";
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
  const deny = await requireProjectOwner404(projectId);
  if (deny) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const jobId = formData.get("jobId") as string | null;

    if (!file || !jobId) {
      return NextResponse.json({ error: "File and jobId required" }, { status: 400 });
    }

    const text = await file.text();
    const filename = file.name.toLowerCase();

    let chunks: string[] = [];
    if (filename.endsWith(".csv")) {
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      chunks = lines.slice(1);
    } else {
      chunks = text
        .split(/\n\n|\r\n\r\n/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 20);
    }

    const rows = chunks.map((chunk, idx) => ({
      projectId,
      jobId,
      source: "LOCAL_BUSINESS",
      type: "document",
      content: chunk,
      metadata: {
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        chunkIndex: idx + 1,
        uploadSource: "USER_UPLOAD",
      },
    }));

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
