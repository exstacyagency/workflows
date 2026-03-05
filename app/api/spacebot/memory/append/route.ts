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
const ALLOWED_AGENTS = ["creative", "research", "billing", "support"] as const;
type Agent = (typeof ALLOWED_AGENTS)[number];

export async function POST(req: NextRequest) {
  const internalSecret = req.headers.get("x-spacebot-secret");
  const isInternal =
    internalSecret &&
    internalSecret === process.env.SPACEBOT_INTERNAL_SECRET;

  let userId: string | null = null;
  if (!isInternal) {
    const session = await getServerSession(authOptions);
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    userId = String((session.user as { id?: string })?.id ?? "").trim() || null;
    if (!userId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const agent = String(body?.agent ?? "").trim() as Agent;
  const projectId = String(body?.projectId ?? "").trim();
  const facts = (body?.facts ?? {}) as Record<string, string>;

  if (!ALLOWED_AGENTS.includes(agent) || !projectId || !facts || typeof facts !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!isInternal && userId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project)
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    // Build a markdown ingest file from the facts.
    // Spacebot's ingestion loop picks up any .md file dropped in
    // /data/agents/{agent}/workspace/ingest/, extracts structured memories,
    // and deletes the file automatically.
    const timestamp = new Date().toISOString();
    const ingestId = `${Date.now()}-${agent}-memory-append`;
    const sections = Object.entries(facts)
      .filter(([, v]) => String(v ?? "").trim())
      .map(([k, v]) => `## ${k}\n${String(v).trim()}`)
      .join("\n\n");

    const content = `---
source: memory-append
projectId: ${projectId}
agent: ${agent}
timestamp: ${timestamp}
---

# Memory Update — ${agent}

${sections}
`.trim();

    const tmpPath = path.join(os.tmpdir(), `${ingestId}.md`);
    await fs.writeFile(tmpPath, content, "utf-8");

    // Copy into the agent's ingest folder — Spacebot watches this and
    // processes the file automatically, then deletes it.
    await execAsync(
      `docker cp ${tmpPath} spacebot:/data/agents/${agent}/workspace/ingest/${ingestId}.md`
    );
    await fs.unlink(tmpPath).catch(() => {});

    await prisma.spacebotAuditLog.create({
      data: {
        agent,
        file: `ingest/${ingestId}.md`,
        action: "memory_append",
        userEmail: isInternal ? "spacebot-internal" : "session-user",
        userId: userId ?? "internal",
        summary: `Queued ${Object.keys(facts).length} fact(s) for ingest — project ${projectId}`,
      },
    });

    return NextResponse.json({ ok: true, queued: Object.keys(facts) });
  } catch (err) {
    console.error("[memory/append] Failed:", err);
    return NextResponse.json({ error: "Failed to queue memory" }, { status: 500 });
  }
}
