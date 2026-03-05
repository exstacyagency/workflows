import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
const execAsync = promisify(exec);

const AGENTS = ["creative", "research", "billing", "support"] as const;

const DEFAULT_MEMORIES: Record<string, Record<string, string>> = {
  creative: {
    brand_voice: "",
    approved_creative_decisions: "",
    cost_confirmation_preferences: "Confirm any video generation job estimated over $10 before starting.",
    campaign_goals: "",
  },
  research: {
    recurring_research_patterns: "",
    client_segment_insights: "",
    data_source_preferences: "",
  },
  billing: {
    spend_cap_preferences: "",
    plan_tier_context: "",
    cost_anomaly_observations: "",
  },
  support: {
    recurring_failure_patterns: "",
    known_infrastructure_issues: "",
    resolution_history: "",
  },
};

export async function seedProjectMemory(
  projectId: string,
  projectName: string,
  userId: string,
  overrides: Partial<Record<string, Record<string, string>>> = {}
) {
  void userId;
  const timestamp = new Date().toISOString();

  await Promise.allSettled(
    AGENTS.map(async (agent) => {
      const memories = {
        ...DEFAULT_MEMORIES[agent],
        ...(overrides[agent] ?? {}),
      };

      const hasContent = Object.values(memories).some((v) => v.trim());
      if (!hasContent) return;

      const content = buildMemoryDocument(projectName, agent, memories, timestamp);
      const tmpPath = path.join(os.tmpdir(), `spacebot-${agent}-init-${Date.now()}.md`);
      await fs.writeFile(tmpPath, content, "utf-8");
      await execAsync(`docker cp ${tmpPath} spacebot:/data/agents/${agent}/workspace/USER.md`);
      await fs.unlink(tmpPath);
    })
  );
}

function buildMemoryDocument(
  projectName: string,
  agent: string,
  memories: Record<string, string>,
  timestamp: string
): string {
  const sections = Object.entries(memories)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `## ${formatKey(key)}\n${value.trim()}`)
    .join("\n\n");

  if (!sections) return "";

  return `# Project Memory — ${projectName}
Agent: ${agent}
Seeded: ${timestamp}

${sections}`.trim();
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
