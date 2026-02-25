import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { uploadProductSetupObject } from "@/lib/s3Service";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function stripKnownImageExtension(fileName: string): string {
  return fileName.replace(/\.(jpe?g|png|webp)$/i, "");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } },
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const productIdRaw = formData.get("productId");
    const fileRaw = formData.get("file");

    const productId = typeof productIdRaw === "string" ? productIdRaw.trim() : "";
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    if (!(fileRaw instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(fileRaw.type)) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Accepted types: image/jpeg, image/png, image/webp.",
        },
        { status: 400 },
      );
    }
    if (fileRaw.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max size is 10.0MB." },
        { status: 400 },
      );
    }

    const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "id" = ${productId}
      LIMIT 1
    `;
    if (!productRows[0]?.id) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const ext = EXT_BY_MIME[fileRaw.type] || "bin";
    const inputNameRaw = sanitizeFileNameSegment(fileRaw.name || "reference-image");
    const inputName = stripKnownImageExtension(inputNameRaw) || "reference-image";
    const key = `product-refs/${projectId}/${productId}/${Date.now()}-${randomUUID()}-${inputName}.${ext}`;
    const bytes = new Uint8Array(await fileRaw.arrayBuffer());

    const uploadedUrl = await uploadProductSetupObject({
      key,
      body: bytes,
      contentType: fileRaw.type,
      cacheControl: "public, max-age=31536000, immutable",
    });

    if (!uploadedUrl) {
      return NextResponse.json(
        {
          error:
            "Upload failed. Check AWS_S3_BUCKET_PRODUCT_SETUP and related S3 configuration.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        url: uploadedUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to upload product reference image", error);
    return NextResponse.json(
      { error: "Failed to upload product reference image" },
      { status: 500 },
    );
  }
}
