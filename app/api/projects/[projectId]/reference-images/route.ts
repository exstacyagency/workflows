import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getProjectForUser } from "@/lib/projects/getProjectForUser";
import { db } from "@/lib/db";
import { uploadPublicObject } from "@/lib/s3Service";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getFileExtension(filename: string, mimeType: string): string {
  const fromMime = MIME_TO_EXT[mimeType.toLowerCase()];
  if (fromMime) return fromMime;
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return "bin";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await requireSession(req);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await getProjectForUser({
    projectId: params.projectId,
    userId: session.user.id,
    includeJobs: false,
  });
  if (!project) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const formData = await req.formData();
  const kindRaw = formData.get("kind");
  const file = formData.get("file");

  const kind = kindRaw === "creator" || kindRaw === "product" ? kindRaw : null;
  if (!kind) {
    return NextResponse.json(
      { error: "kind must be either 'creator' or 'product'" },
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (!file.type || !file.type.toLowerCase().startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are allowed" },
      { status: 400 }
    );
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` },
      { status: 413 }
    );
  }

  const extension = getFileExtension(file.name, file.type);
  const key = [
    "project-reference-images",
    project.id,
    kind,
    `${Date.now()}-${randomUUID()}.${extension}`,
  ].join("/");
  const body = Buffer.from(await file.arrayBuffer());

  const uploadedUrl = await uploadPublicObject({
    key,
    body,
    contentType: file.type || "application/octet-stream",
    cacheControl: "public, max-age=31536000, immutable",
  });

  if (!uploadedUrl) {
    return NextResponse.json(
      { error: "Media storage is not configured for file uploads" },
      { status: 503 }
    );
  }

  if (kind === "creator") {
    await db.$executeRaw`
      UPDATE "project"
      SET "creatorReferenceImageUrl" = ${uploadedUrl}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${project.id}
    `;
  } else {
    await db.$executeRaw`
      UPDATE "project"
      SET "productReferenceImageUrl" = ${uploadedUrl}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${project.id}
    `;
  }

  const rows = await db.$queryRaw<Array<{
    id: string;
    creatorReferenceImageUrl: string | null;
    productReferenceImageUrl: string | null;
    updatedAt: Date;
  }>>`
    SELECT
      "id",
      "creatorReferenceImageUrl" AS "creatorReferenceImageUrl",
      "productReferenceImageUrl" AS "productReferenceImageUrl",
      "updatedAt" AS "updatedAt"
    FROM "project"
    WHERE "id" = ${project.id}
    LIMIT 1
  `;
  const updatedProject = rows[0];
  if (!updatedProject) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      kind,
      url: uploadedUrl,
      project: updatedProject,
    },
    { status: 200 }
  );
}
