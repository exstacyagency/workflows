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

const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined,
    { message: "At least one field is required" },
  );

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
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

  if (Object.keys(data).length > 0) {
    await db.project.update({
      where: { id: project.id },
      data,
    });
  }

  const rows = await db.$queryRaw<Array<{
    id: string;
    name: string;
    description: string | null;
    updatedAt: Date;
  }>>`
    SELECT
      "id",
      "name",
      "description",
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
