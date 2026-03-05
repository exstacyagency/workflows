"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

const AGENTS = ["creative", "research", "billing", "support"] as const;
type Agent = (typeof AGENTS)[number];

const AGENT_FIELDS: Record<Agent, { key: string; label: string; placeholder: string }[]> = {
  creative: [
    { key: "brand_voice", label: "Brand Voice", placeholder: "e.g. Bold, energetic, speaks to 18-34 year olds. Avoid corporate language." },
    { key: "campaign_goals", label: "Campaign Goals", placeholder: "e.g. Drive app installs for the summer campaign. Target CPI under $2." },
    { key: "approved_creative_decisions", label: "Approved Creative Decisions", placeholder: "e.g. Always use the approved storyboard template from March 2025." },
    { key: "cost_confirmation_preferences", label: "Cost Confirmation Preferences", placeholder: "e.g. Confirm any video generation job over $10 before starting." },
  ],
  research: [
    { key: "recurring_research_patterns", label: "Recurring Research Patterns", placeholder: "e.g. Always pull 90 days of ad performance data for pattern analysis." },
    { key: "client_segment_insights", label: "Client Segment Insights", placeholder: "e.g. Primary segment is budget-conscious moms aged 28-42." },
    { key: "data_source_preferences", label: "Data Source Preferences", placeholder: "e.g. Prefer Amazon reviews over Reddit for product sentiment." },
  ],
  billing: [
    { key: "spend_cap_preferences", label: "Spend Cap Preferences", placeholder: "e.g. Alert when monthly spend exceeds $150." },
    { key: "plan_tier_context", label: "Plan Context", placeholder: "e.g. On Pro plan, $200/month cap." },
    { key: "cost_anomaly_observations", label: "Cost Anomaly Notes", placeholder: "e.g. Video upscaler jobs tend to run 20% over estimate." },
  ],
  support: [
    { key: "recurring_failure_patterns", label: "Recurring Failure Patterns", placeholder: "e.g. KIE video generation fails when scene duration exceeds 8 seconds." },
    { key: "known_infrastructure_issues", label: "Known Issues", placeholder: "e.g. Fal merge endpoint occasionally times out on large clips." },
    { key: "resolution_history", label: "Resolution History", placeholder: "e.g. Retry after 5 min usually resolves KIE timeout errors." },
  ],
};

const agentColors: Record<Agent, { tab: string; dot: string; badge: string }> = {
  creative: { tab: "border-violet-500 text-violet-400", dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  research: { tab: "border-blue-500 text-blue-400", dot: "bg-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  billing: { tab: "border-emerald-500 text-emerald-400", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  support: { tab: "border-amber-500 text-amber-400", dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

export default function MemorySeedingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeAgent, setActiveAgent] = useState<Agent>("creative");
  const [memories, setMemories] = useState<Record<Agent, Record<string, string>>>({
    creative: { brand_voice: "", campaign_goals: "", approved_creative_decisions: "", cost_confirmation_preferences: "Confirm any video generation job estimated over $10 before starting." },
    research: { recurring_research_patterns: "", client_segment_insights: "", data_source_preferences: "" },
    billing: { spend_cap_preferences: "", plan_tier_context: "", cost_anomaly_observations: "" },
    support: { recurring_failure_patterns: "", known_infrastructure_issues: "", resolution_history: "" },
  });
  const [saving, setSaving] = useState<Agent | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<Agent, "idle" | "success" | "error">>({
    creative: "idle", research: "idle", billing: "idle", support: "idle",
  });

  function updateField(agent: Agent, key: string, value: string) {
    setMemories((prev) => ({
      ...prev,
      [agent]: { ...prev[agent], [key]: value },
    }));
  }

  async function saveAgent(agent: Agent) {
    setSaving(agent);
    try {
      const res = await fetch(`/api/admin/spacebot/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, agent, memories: memories[agent] }),
      });
      if (!res.ok) throw new Error();
      setSaveStatus((prev) => ({ ...prev, [agent]: "success" }));
      setTimeout(() => setSaveStatus((prev) => ({ ...prev, [agent]: "idle" })), 3000);
    } catch {
      setSaveStatus((prev) => ({ ...prev, [agent]: "error" }));
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    for (const agent of AGENTS) {
      await saveAgent(agent);
    }
  }

  const fields = AGENT_FIELDS[activeAgent];
  const colors = agentColors[activeAgent];
  const filledCount = (agent: Agent) =>
    Object.values(memories[agent]).filter((v) => v.trim()).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 bg-gray-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-white">Agent Memory</h1>
            <p className="text-xs text-gray-500">Seed context for each Spacebot agent on this project</p>
          </div>
          <button
            onClick={saveAll}
            disabled={!!saving}
            className="text-xs font-medium px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save All Agents"}
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-6 flex gap-1">
          {AGENTS.map((agent) => {
            const c = agentColors[agent];
            const count = filledCount(agent);
            return (
              <button
                key={agent}
                onClick={() => setActiveAgent(agent)}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                  activeAgent === agent ? c.tab + " bg-gray-800/40" : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                <span className="capitalize">{agent}</span>
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full border ${c.badge}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="rounded-xl border border-gray-700/50 bg-gray-900/40 p-4 mb-6 flex gap-3">
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5"
            style={{ width: 16, height: 16, minWidth: 16 }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-gray-400 leading-relaxed">
            Memory is seeded into Spacebot&apos;s ingestion pipeline and processed automatically. The <span className="text-white font-medium capitalize">{activeAgent}</span> agent will reference this context in every conversation on this project. Leave fields blank to skip them.
          </p>
        </div>

        <div className="space-y-5">
          {fields.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">{label}</label>
              <textarea
                value={memories[activeAgent][key] ?? ""}
                onChange={(e) => updateField(activeAgent, key, e.target.value)}
                placeholder={placeholder}
                rows={3}
                className="w-full bg-gray-900 text-gray-100 text-sm border border-gray-700 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 placeholder-gray-600 leading-relaxed"
              />
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-gray-800 pt-6">
          <p className="text-xs text-gray-600">
            Saves drop a memory document into Spacebot&apos;s ingest folder. Processing is automatic and near-instant.
          </p>
          <div className="flex items-center gap-3">
            {saveStatus[activeAgent] === "success" && (
              <span className="text-xs text-emerald-400">✓ Seeded into Spacebot</span>
            )}
            {saveStatus[activeAgent] === "error" && (
              <span className="text-xs text-red-400">Failed — check API route</span>
            )}
            <button
              onClick={() => void saveAgent(activeAgent)}
              disabled={saving === activeAgent}
              className={`text-xs font-medium px-5 py-2 rounded-lg transition-all capitalize ${
                saving === activeAgent
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {saving === activeAgent ? "Seeding..." : `Seed ${activeAgent} memory`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
