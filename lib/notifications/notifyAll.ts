import prisma from "@/lib/prisma";
import { cfg } from "@/lib/config";
import { ssePublish } from "@/lib/notifications/ssePublisher";

export interface JobCompletionPayload {
  jobId: string;
  jobType: string;
  projectId: string;
  runId?: string | null;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  message: string;
  costCents?: number;
  resultSummary?: unknown;
  error?: string;
}

type ProjectUser = {
  id: string;
  openClawSessionKey: string | null;
};

let openClawConfigWarned = false;
function warnOpenClawConfig() {
  if (openClawConfigWarned) return;
  openClawConfigWarned = true;

  if (!String(cfg.raw("OPENCLAW_BASE_URL") ?? "").trim()) {
    console.warn("[notifyAll] OPENCLAW_BASE_URL is not set — OpenClaw notifications disabled");
  }
  if (!String(cfg.raw("OPENCLAW_WEBHOOK_SECRET") ?? "").trim()) {
    console.warn("[notifyAll] OPENCLAW_WEBHOOK_SECRET is not set — hook calls will be unauthenticated");
  }
}

async function getProjectUsers(projectId: string): Promise<ProjectUser[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      user: {
        select: {
          id: true,
          openClawSessionKey: true,
        },
      },
    },
  });

  if (!project?.user) return [];
  return [project.user];
}

async function notifyOpenClaw(payload: JobCompletionPayload) {
  warnOpenClawConfig();

  const baseUrl = String(cfg.raw("OPENCLAW_BASE_URL") ?? "").trim();
  const secret = String(cfg.raw("OPENCLAW_WEBHOOK_SECRET") ?? "").trim();

  if (!baseUrl) {
    console.warn("[notifyAll] OPENCLAW_BASE_URL not set; skipping OpenClaw notification");
    return;
  }

  const body = {
    message: payload.message,
    name: "AdPlatform",
    agentId: "main",
    wakeMode: "now",
    deliver: true,
    channel: "last",
  };

  const res = await fetch(`${baseUrl}/hooks/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    console.warn(`[notifyAll] OpenClaw hook returned ${res.status}`);
  } else {
    console.log(
      `[notifyAll] OpenClaw notified OK — job ${payload.jobId} (${payload.jobType})`,
    );
  }
}

async function notifySpacebot(webhookUrl: string, payload: JobCompletionPayload) {
  void webhookUrl;
  void payload;
}

export async function notifyAll(payload: JobCompletionPayload) {
  try {
    const [binding, users] = await Promise.all([
      prisma.projectAgentBinding.findUnique({
        where: { projectId: payload.projectId },
      }),
      getProjectUsers(payload.projectId),
    ]);

    await Promise.allSettled([
      ssePublish(payload.projectId, payload),
      binding?.spaceBotWebhookUrl && binding.spaceBotEnabled
        ? notifySpacebot(binding.spaceBotWebhookUrl, payload)
        : Promise.resolve(),
      users.some((user) => Boolean(user.openClawSessionKey))
        ? notifyOpenClaw(payload)
        : Promise.resolve(),
    ]);
  } catch (err) {
    console.error("[notifyAll] Unexpected non-fatal error", err);
  }
}
