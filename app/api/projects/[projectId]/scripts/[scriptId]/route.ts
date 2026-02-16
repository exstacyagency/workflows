import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

type Params = {
  params: {
    projectId: string;
    scriptId: string;
  };
};

type ScriptSceneInput = {
  beat?: unknown;
  duration?: unknown;
  vo?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseScenes(value: unknown): Array<{ beat: string; duration: string | number | null; vo: string }> | null {
  if (!Array.isArray(value)) return null;

  return value.map((scene, index) => {
    const raw = (scene ?? {}) as ScriptSceneInput;
    const beat = typeof raw.beat === "string" && raw.beat.trim() ? raw.beat.trim() : `Beat ${index + 1}`;
    const vo = typeof raw.vo === "string" ? raw.vo : "";
    const duration =
      typeof raw.duration === "number" || typeof raw.duration === "string" ? raw.duration : null;

    return {
      beat,
      duration,
      vo,
    };
  });
}

async function findScript(projectId: string, scriptId: string) {
  return prisma.script.findFirst({
    where: { id: scriptId, projectId },
    select: {
      id: true,
      projectId: true,
      jobId: true,
      status: true,
      rawJson: true,
      wordCount: true,
      createdAt: true,
    },
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, scriptId } = params;
  if (!projectId || !scriptId) {
    return NextResponse.json({ error: "projectId and scriptId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const script = await findScript(projectId, scriptId);
  if (!script) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }

  return NextResponse.json(script, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, scriptId } = params;
  if (!projectId || !scriptId) {
    return NextResponse.json({ error: "projectId and scriptId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const script = await findScript(projectId, scriptId);
  if (!script) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const scenes = parseScenes((body as Record<string, unknown> | null)?.scenes);
  if (!scenes) {
    return NextResponse.json({ error: "Invalid scenes payload" }, { status: 400 });
  }

  const voFull = scenes.map((scene) => scene.vo.trim()).filter(Boolean).join(" ").trim();
  const wordCount = voFull ? voFull.split(/\s+/).length : 0;
  const rawJson = asObject(script.rawJson) ?? {};
  const nextRawJson = {
    ...rawJson,
    scenes,
    vo_full: voFull,
    word_count: wordCount,
  };

  const updated = await prisma.script.update({
    where: { id: scriptId },
    data: {
      rawJson: nextRawJson as any,
      wordCount,
    },
    select: {
      id: true,
      projectId: true,
      jobId: true,
      status: true,
      rawJson: true,
      wordCount: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, script: updated }, { status: 200 });
}
