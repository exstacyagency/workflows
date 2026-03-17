import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin/isAdminRequest";
import {
  buildProjectPurgeConfirmationPhrase,
  getProjectPurgePreview,
  purgeProjectArtifacts,
} from "@/lib/projectPurge";

export const runtime = "nodejs";

async function resolveAuthorizedProject(req: NextRequest, projectId: string) {
  const admin = isAdminRequest(req);
  const userId = admin ? null : await getSessionUserId();

  if (!admin && !userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, userId: true },
  });

  if (!project) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    };
  }

  if (!admin && project.userId !== userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    };
  }

  return {
    ok: true as const,
    project,
    admin,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const awaitedParams = await params;
  const projectId = String(awaitedParams?.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const access = await resolveAuthorizedProject(req, projectId);
  if (!access.ok) return access.response;

  const preview = await prisma.$transaction((tx) =>
    getProjectPurgePreview({
      tx,
      projectId,
      projectName: access.project.name,
    }),
  );

  return NextResponse.json({
    success: true,
    preview,
    requiresConfirmation: true,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const awaitedParams = await params;
  const projectId = String(awaitedParams?.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const access = await resolveAuthorizedProject(req, projectId);
  if (!access.ok) return access.response;

  let body: { confirmation?: unknown } = {};
  try {
    body = (await req.json()) as { confirmation?: unknown };
  } catch {
    body = {};
  }

  const expectedPhrase = buildProjectPurgeConfirmationPhrase(access.project.name);
  const providedPhrase = String(body.confirmation ?? "").trim();
  if (providedPhrase !== expectedPhrase) {
    return NextResponse.json(
      {
        error: "Confirmation phrase mismatch",
        expectedConfirmation: expectedPhrase,
      },
      { status: 400 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const preview = await getProjectPurgePreview({
      tx,
      projectId,
      projectName: access.project.name,
    });
    const deleted = await purgeProjectArtifacts({ tx, projectId });
    return { preview, deleted };
  });

  return NextResponse.json({
    success: true,
    deletedProjectId: projectId,
    preview: result.preview,
    deleted: result.deleted,
  });
}
