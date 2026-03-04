// lib/notifications/notifyAll.ts

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

const JOB_TYPE_TO_AGENT: Record<string, string> = {
  SCRIPT_GENERATION:          "creative",
  STORYBOARD_GENERATION:      "creative",
  VIDEO_PROMPT_GENERATION:    "creative",
  VIDEO_IMAGE_GENERATION:     "creative",
  VIDEO_GENERATION:           "creative",
  VIDEO_UPSCALER:             "creative",
  AD_QUALITY_GATE:            "creative",
  CREATOR_AVATAR_GENERATION:  "creative",
  CHARACTER_SEED_VIDEO:       "creative",
  CUSTOMER_RESEARCH:          "research",
  CUSTOMER_ANALYSIS:          "research",
  PATTERN_ANALYSIS:           "research",
  AD_PERFORMANCE:             "research",
  PRODUCT_DATA_COLLECTION:    "research",
  PRODUCT_ANALYSIS:           "research",
  VIDEO_REVIEW:               "research",
  CHARACTER_VOICE_SETUP:      "research",
};

function formatMessage(payload: JobCompletionPayload): string {
  const cost = payload.costCents
    ? ` Cost: $${(payload.costCents / 100).toFixed(2)}.`
    : "";
  return payload.message || `${payload.status}: ${payload.jobType}.${cost}`;
}

async function getProjectUserIds(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { user: { select: { id: true } } },
  });
  if (!project?.user) return [];
  return [project.user.id];
}

async function notifySpacebot(
  agentId: string,
  sessionKey: string,
  message: string,
) {
  const baseUrl = String(cfg.raw("SPACEBOT_BASE_URL") ?? "").trim();
  if (!baseUrl) {
    console.warn("[notifyAll] SPACEBOT_BASE_URL not set — skipping");
    return;
  }

  const res = await fetch(`${baseUrl}/hooks/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id:    agentId,
      session_key: sessionKey,
      message,
      deliver:     true,
      wake_mode:   "now",
      channel:     "last",
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    console.warn(`[notifyAll] Spacebot hook returned ${res.status}`);
  } else {
    console.log(`[notifyAll] Spacebot notified — session ${sessionKey}`);
  }
}

export async function notifyAll(payload: JobCompletionPayload) {
  try {
    const agentId  = JOB_TYPE_TO_AGENT[payload.jobType] ?? "creative";
    const message  = formatMessage(payload);
    const userIds  = await getProjectUserIds(payload.projectId);

    const notifications = userIds.map((userId) => {
      const sessionKey = `${agentId}:webchat-${userId}:${payload.projectId}`;
      return notifySpacebot(agentId, sessionKey, message);
    });

    const results = await Promise.allSettled([
      ssePublish(payload.projectId, payload),
      ...notifications,
    ]);

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[notifyAll] delivery ${i} failed:`, r.reason);
      }
    });
  } catch (err) {
    console.error("[notifyAll] Unexpected error", err);
  }
}
