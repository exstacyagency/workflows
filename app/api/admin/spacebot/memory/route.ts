import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
const execAsync = promisify(exec);

const ALLOWED_AGENTS = ["creative", "research", "billing", "support"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = String(body?.projectId ?? "").trim();
  const agent = String(body?.agent ?? "").trim();
  const memories = (body?.memories ?? {}) as Record<string, string>;

  if (!projectId || !ALLOWED_AGENTS.includes(agent)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const userId = String((session.user as { id?: string })?.id ?? "").trim();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const timestamp = new Date().toISOString();
  const content = buildMemoryDocument(project.name, agent, memories, timestamp);

  try {
    const tmpPath = path.join(os.tmpdir(), `spacebot-${agent}-${Date.now()}.md`);
    await fs.writeFile(tmpPath, content, "utf-8");
    await execAsync(`docker cp ${tmpPath} spacebot:/data/agents/${agent}/workspace/USER.md`);
    await fs.unlink(tmpPath);
  } catch (err) {
    console.error("Failed to write memory file:", err);
    return NextResponse.json({ error: "Failed to seed memory" }, { status: 500 });
  }

  await prisma.spacebotAuditLog.create({
    data: {
      agent,
      file: "USER.md",
      action: "memory_seed",
      userEmail: session.user.email ?? "unknown",
      userId,
      summary: `Seeded memory for project ${project.name}`,
    },
  });

  return NextResponse.json({ ok: true, file: "USER.md" });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const agent = searchParams.get("agent");

  if (!projectId || !agent || !ALLOWED_AGENTS.includes(agent)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const userId = String((session.user as { id?: string })?.id ?? "").trim();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const tmpPath = path.join(os.tmpdir(), `spacebot-read-${agent}-${Date.now()}.md`);
    await execAsync(`docker cp spacebot:/data/agents/${agent}/workspace/USER.md ${tmpPath}`);
    const content = await fs.readFile(tmpPath, "utf-8");
    await fs.unlink(tmpPath);
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

function buildMemoryDocument(
  projectName: string,
  agent: string,
  memories: Record<string, string>,
  timestamp: string
): string {
  const sections = Object.entries(memories)
    .filter(([, value]) => String(value ?? "").trim())
    .map(([key, value]) => `## ${formatKey(key)}\n${String(value).trim()}`)
    .join("\n\n");

  return `# Project Memory — ${projectName}
Agent: ${agent}
Seeded: ${timestamp}

${sections}
`.trim();
}

function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
