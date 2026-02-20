import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/requireSession"
import { getProjectForUser } from "@/lib/projects/getProjectForUser"
import { db } from "@/lib/db"
import { z } from "zod"

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await requireSession(req)

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const project = await getProjectForUser({
    projectId: params.projectId,
    userId: session.user.id,
    includeJobs: true,
  })

  if (!project) {
    return NextResponse.json(
      { error: "Not Found" },
      { status: 404 }
    )
  }

  return NextResponse.json(project, { status: 200 })
}

const nullableUrlField = z
  .union([z.string().trim().url().max(2048), z.literal(""), z.null()])
  .optional();

const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    creatorReferenceImageUrl: nullableUrlField,
    productReferenceImageUrl: nullableUrlField,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.creatorReferenceImageUrl !== undefined ||
      value.productReferenceImageUrl !== undefined,
    { message: "At least one field is required" },
  );

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await requireSession(req);

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const project = await getProjectForUser({
    projectId: params.projectId,
    userId: session.user.id,
    includeJobs: false,
  });

  if (!project) {
    return NextResponse.json(
      { error: "Not Found" },
      { status: 404 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data: {
    name?: string;
    description?: string | null;
  } = {};

  const normalizedName = normalizeNullableString(parsed.data.name);
  if (normalizedName !== undefined) {
    if (!normalizedName) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }
    data.name = normalizedName;
  }

  const normalizedDescription = normalizeNullableString(parsed.data.description);
  if (normalizedDescription !== undefined) {
    data.description = normalizedDescription;
  }

  const normalizedCreatorUrl = normalizeNullableUrl(parsed.data.creatorReferenceImageUrl);
  const normalizedProductUrl = normalizeNullableUrl(parsed.data.productReferenceImageUrl);
  if (Object.keys(data).length > 0) {
    await db.project.update({
      where: { id: project.id },
      data,
    });
  }

  if (normalizedCreatorUrl !== undefined) {
    await db.$executeRaw`
      UPDATE "project"
      SET "creatorReferenceImageUrl" = ${normalizedCreatorUrl}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${project.id}
    `;
  }

  if (normalizedProductUrl !== undefined) {
    await db.$executeRaw`
      UPDATE "project"
      SET "productReferenceImageUrl" = ${normalizedProductUrl}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${project.id}
    `;
  }

  const rows = await db.$queryRaw<Array<{
    id: string;
    name: string;
    description: string | null;
    creatorReferenceImageUrl: string | null;
    productReferenceImageUrl: string | null;
    updatedAt: Date;
  }>>`
    SELECT
      "id",
      "name",
      "description",
      "creatorReferenceImageUrl" AS "creatorReferenceImageUrl",
      "productReferenceImageUrl" AS "productReferenceImageUrl",
      "updatedAt" AS "updatedAt"
    FROM "project"
    WHERE "id" = ${project.id}
    LIMIT 1
  `;

  const updated = rows[0];
  if (!updated) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json(updated, { status: 200 });
}
