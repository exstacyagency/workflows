"use client";
import { useState } from "react";

// ─── Styles are now in globals.css ──────────────────────────────────────────

// ─── Mock Data ────────────────────────────────────────────────────────────────
const AGENTS = [
  { id: "orchestrator", name: "Orchestrator", status: "online", channels: 8, memories: 142, model: "haiku-4.5", slot: "orchestrator" },
  { id: "research",     name: "Research",     status: "online", channels: 4, memories: 89,  model: "sonnet-4.6", slot: "worker_a" },
  { id: "creative",     name: "Creative",     status: "idle",   channels: 4, memories: 61,  model: "sonnet-4.6", slot: "worker_b" },
  { id: "cortex",       name: "Cortex",       status: "idle",   channels: 0, memories: 310, model: "haiku-4.5",  slot: "cortex"  },
];

const SLOT_ACCENT = {
  orchestrator: "var(--success)",
  worker_a:     "var(--accent-2)",
  worker_b:     "var(--accent)",
  cortex:       "rgb(167, 139, 250)", // Keep specific violet for Cortex but use RGB
  default:      "var(--muted)",
};

const TABS = ["Overview","Chat","Channels","Memories","Ingest","Workers","Tasks","Cortex","Skills","Cron","Config"];

const MEMORIES = [
  { id:1, type:"preference", content:"Always speak in short commands.", importance:0.90, source:"user stated",  ago:"1d ago" },
  { id:2, type:"fact",       content:"User runs an ad-platform business focused on creative automation.", importance:0.85, source:"cortex", ago:"3d ago" },
  { id:3, type:"decision",   content:"Research agent should use Opus for all pattern analysis jobs.", importance:0.80, source:"user stated", ago:"5d ago" },
  { id:4, type:"goal",       content:"Ship the agentopia infrastructure package by end of March.", importance:0.75, source:"cortex", ago:"6d ago" },
  { id:5, type:"observation",content:"User frequently requests concise, command-style responses.", importance:0.70, source:"cortex", ago:"1w ago" },
];

const CHANNELS = [
  { id:"ch1", name:"billing:webchat-cmlpearyw0000", platform:"webchat", active:true, ago:"1d ago", preview:"always speak in short commands" },
  { id:"ch2", name:"research:discord-847392",        platform:"discord", active:false, ago:"3d ago", preview:"kick off customer research for brand X" },
];

const WORKERS = [
  { id:"w1", job:"CUSTOMER_RESEARCH", slot:"worker_a", elapsed:"1m 22s", status:"running" },
  { id:"w2", job:"SCRIPT_GENERATION", slot:"worker_b", elapsed:"0m 44s", status:"running" },
];

const TASKS = [
  { id:"t1", job:"CUSTOMER_RESEARCH", status:"completed", credits:"-1.20", ago:"10m ago", model:"sonnet-4.6" },
  { id:"t2", job:"SCRIPT_GENERATION", status:"completed", credits:"-0.80", ago:"25m ago", model:"sonnet-4.6" },
  { id:"t3", job:"PATTERN_ANALYSIS",  status:"failed",    credits:"-0.00", ago:"1h ago",  model:"opus-4.6"   },
  { id:"t4", job:"AD_COLLECTION",     status:"dead_letter",credits:"-0.00",ago:"2h ago",  model:"haiku-4.5"  },
];

const CORTEX_LOG = [
  { ago:"10m ago", type:"bulletin generated", msg:"Bulletin generated: 53 words, 3 sections, 1931ms" },
  { ago:"10m ago", type:"warmup succeeded",   msg:"Warmup pass completed" },
  { ago:"25m ago", type:"bulletin generated", msg:"Bulletin generated: 46 words, 3 sections, 1885ms" },
  { ago:"26m ago", type:"profile generated",  msg:'Profile generated: CommandMate — "keeping it short and sharp" (2153ms)' },
  { ago:"40m ago", type:"bulletin generated", msg:"Bulletin generated: 27 words, 3 sections, 1611ms" },
  { ago:"55m ago", type:"warmup succeeded",   msg:"Warmup pass completed" },
  { ago:"1h ago",  type:"bulletin generated", msg:"Bulletin generated: 41 words, 3 sections, 1797ms" },
];

const SKILLS = [
  { id:"s1", name:"find-skills",              author:"vercel-labs/skills",       installs:"432.2k", desc:"Discover and install skills from the open agent skills ecosystem." },
  { id:"s2", name:"vercel-react-best-practices", author:"vercel-labs/agent-skills", installs:"179.8k", desc:"React best practices for agent-generated code." },
  { id:"s3", name:"frontend-design",          author:"anthropic/skills",          installs:"86.0k",  desc:"Create distinctive, production-grade frontend interfaces." },
  { id:"s4", name:"web-design-guidelines",    author:"vercel-labs/agent-skills",  installs:"140.0k", desc:"Review files for compliance with Web Interface Guidelines." },
];

const CRON_JOBS = [
  { id:"cj1", name:"daily-spend-check", status:"disabled", interval:"every 1440m", type:"webhook", desc:"Check platform spend by calling GET /api/internal/spend-summary..." },
  { id:"cj2", name:"cortex-cycle",      status:"active",   interval:"every 360m",  type:"agent",   desc:"Run Cortex extraction across all active user sessions." },
];

const SOUL_MD = `<!-- Define this agent's soul: personality, values, communication style, boundaries. -->

## Memory
Save memories for: spend cap preferences, cost alert thresholds, and
plan context. Use type "preference" for spending rules, "fact" for
plan tier details.

## Explicit Directives
When a user states a preference, priority, or instruction that should apply
consistently (e.g. "always use X", "prioritize Y over Z", "for this project
do X"), you MUST immediately spawn a branch to save it before responding.
The branch must call memory_save with type: preference, importance: 0.9.
Do not wait for compaction.

If a directive conflicts with a previously saved memory or your trained
behavior, you MUST ask for explicit confirmation before saving or acting
on it. State clearly what the conflict is and wait for the user to confirm.`;

const CONFIG_SECTIONS = {
  "Core Personality": ["Soul", "Directives", "Voice"],
  "Infrastructure": ["Kernel", "Memory Index", "Slot Mapping"],
  "Safety": ["Boundary Enforcement", "Audit Logs"]
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const accent = (slot) => SLOT_ACCENT[slot] ?? SLOT_ACCENT.default;

const Badge = ({ label, color, type = "info" }) => (
  <span className={`status-chip ${type}`} style={{ color }}>
    {label}
  </span>
);

const STATUS = { online:"var(--success)", idle:"var(--accent)", offline:"var(--muted)", active:"var(--success)", disabled:"var(--muted)", running:"var(--accent-2)", completed:"var(--success)", failed:"rgb(248, 113, 113)", dead_letter:"var(--accent)" };

function Dot({ status }) {
  const c = STATUS[status] ?? "var(--muted)";
  const isActive = status === "online" || status === "active" || status === "running";
  return (
    <span 
      className={`inline-block w-[7px] h-[7px] rounded-full transition-shadow duration-500`} 
      style={{ 
        background: c, 
        boxShadow: isActive ? `0 0 8px ${c}` : "none" 
      }} 
    />
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function AgentSidebar({ agents, activeAgent, setActiveAgent }) {
  return (
    <div className="w-[52px] bg-panel backdrop-blur-panel border-r border-line flex flex-col items-center py-4 gap-2 flex-shrink-0">
      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-[rgb(244,233,181)] mb-3 shadow-[0_0_15px_rgba(232,209,122,0.3)]" />
      {agents.map(a => (
        <button 
          key={a.id} 
          onClick={() => setActiveAgent(a.id)} 
          title={a.name} 
          className={`
            w-9 h-9 rounded-lg border transition-all duration-200 flex items-center justify-center font-mono text-xs font-semibold
            ${activeAgent === a.id 
              ? "bg-panel border-accent/40 text-accent shadow-[0_0_10px_rgba(232,209,122,0.1)]" 
              : "bg-transparent border-transparent text-muted/40 hover:text-white hover:bg-bg-elevated"
            }
          `}
        >
          {a.name[0]}
        </button>
      ))}
      <button className="w-9 h-9 rounded-lg border border-line bg-transparent text-muted/30 text-lg mt-auto hover:text-white hover:border-muted transition-colors">+</button>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
function AgentTabBar({ active, setActive, agentAccent }) {
  return (
    <div className="flex border-b border-line px-6 gap-0 flex-shrink-0">
      {TABS.map(t => (
        <button 
          key={t} 
          onClick={() => setActive(t)} 
          className={`
            px-[14px] pt-3 pb-[10px] text-xs font-sans transition-all duration-200 border-b-2 mb-[-1px]
            ${active === t 
              ? "text-white border-accent" 
              : "text-muted/50 border-transparent hover:text-white transition-colors"
            }
          `}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────
function Overview({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div className="p-7 flex flex-col gap-6 overflow-auto h-full">
      <div>
        <h1 className="text-white font-light tracking-[-0.04em]">{agent.name}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Dot status={agent.status} />
          <span className="text-muted text-xs">{agent.status === "online" ? "Online" : "Idle"}</span>
          {agent.channels > 0 && <span className="text-muted/40 text-xs">{agent.channels} channel{agent.channels !== 1 ? "s" : ""}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Memories", value: agent.memories },
          { label: "Model", value: agent.model },
          { label: "Slot", value: agent.slot },
        ].map(s => (
          <div key={s.label} className="bg-bg-elevated border border-line rounded-card p-5">
            <div className="card-label !mb-2">{s.label}</div>
            <div className="text-white text-base font-mono">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-bg-elevated border border-line rounded-card p-6">
        <div className="card-label !mb-4">MEMORY GROWTH · LAST 30 DAYS</div>
        <svg viewBox="0 0 600 80" className="w-full h-20">
          <polyline points="0,70 100,65 200,55 300,50 400,40 500,25 580,20" fill="none" stroke={ac} strokeWidth="1.5" opacity="0.6" />
          <polyline points="0,70 100,65 200,55 300,50 400,40 500,25 580,20 580,80 0,80" fill={ac} opacity="0.06" />
          {[[580, 20]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={ac} />)}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-bg-elevated border border-line rounded-card p-6">
          <div className="card-label !mb-4">ACTIVITY HEATMAP</div>
          <div className="grid grid-cols-24 gap-[2px]">
            {Array.from({ length: 7 * 24 }).map((_, i) => (
              <div key={i} className="h-2 rounded-[1px]" style={{ background: Math.random() > 0.85 ? ac + "99" : Math.random() > 0.6 ? "var(--bg-elevated)" : "var(--bg)" }} />
            ))}
          </div>
        </div>
        <div className="bg-bg-elevated border border-line rounded-card p-6">
          <div className="card-label !mb-4">PROCESS ACTIVITY</div>
          <svg viewBox="0 0 300 80" className="w-full h-20">
            <polyline points="0,75 60,72 120,60 180,65 240,40 290,20" fill="none" stroke={ac} strokeWidth="1.5" opacity="0.6" />
            {[[290, 20]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={ac} />)}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function Chat({ agent }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const ac = accent(agent.slot);

  const send = () => {
    if (!input.trim()) return;
    setMsgs(m => [...m, { role: "user", text: input }, { role: "agent", text: `[${agent.name}] acknowledged: "${input}"` }]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-7 py-6 flex flex-col gap-3">
        {msgs.length === 0 && (
          <div className="m-auto text-muted/30 text-[13px] font-mono italic">Start a conversation with {agent.name}</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`
              max-w-[60%] px-4 py-[10px] rounded-inner text-[13px] backdrop-blur-panel border transition-all duration-200
              ${m.role === "user" 
                ? "bg-accent/10 border-accent/30 text-white" 
                : "bg-panel border-line text-muted shadow-panel"
              }
            `}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="px-6 py-4 border-t border-line flex gap-3 bg-panel">
        <input 
          value={input} 
          onChange={e => setInput(e.target.value)} 
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={`Message ${agent.name}...`}
          className="flex-1 bg-bg-elevated border border-line rounded-pill px-4 py-[10px] text-white text-[13px] outline-none focus:border-accent/50 transition-colors" 
        />
        <button 
          onClick={send} 
          className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-accent to-[rgb(244,233,181)] text-bg text-lg flex items-center justify-center shadow-[0_0_15px_rgba(232,209,122,0.2)] hover:scale-105 active:scale-95 transition-transform"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

// ─── Channels ────────────────────────────────────────────────────────────────
function Channels({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full">
      <input 
        placeholder="Search channels..." 
        className="bg-bg-elevated border border-line rounded-pill px-3 py-2 text-muted text-xs outline-none focus:border-accent/40 transition-colors w-full" 
      />
      {CHANNELS.map(ch => (
        <div key={ch.id} className="bg-panel border border-line rounded-card p-5 hover:bg-panel-strong transition-colors group">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-white text-[13px] font-mono flex-1 group-hover:text-accent transition-colors">{ch.name}</span>
            <Dot status={ch.active ? "online" : "offline"} />
            <span className="text-muted/30 text-[11px] font-mono">{ch.ago}</span>
          </div>
          <Badge label={ch.platform} color={ac} type="info" />
          <p className="text-muted text-xs mt-3 leading-relaxed">{ch.preview}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Memories ────────────────────────────────────────────────────────────────
const MEM_COLORS = { preference:"var(--accent-2)", fact:"var(--accent-2)", decision:"var(--accent)", goal:"var(--success)", observation:"var(--accent)", event:"rgb(248, 113, 113)", identity:"rgb(232, 121, 249)", todo:"var(--muted)" };

function Memories({ agent }) {
  const [filter, setFilter] = useState("all");
  const types = ["all", "fact", "preference", "decision", "identity", "event", "observation", "goal", "todo"];
  const shown = filter === "all" ? MEMORIES : MEMORIES.filter(m => m.type === filter);

  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full font-sans">
      <div className="flex gap-3 items-center">
        <input 
          placeholder="Search memories..." 
          className="flex-1 bg-bg-elevated border border-line rounded-pill px-3 py-2 text-muted text-xs outline-none focus:border-accent/40 transition-colors" 
        />
      </div>
      <div className="flex gap-2 flex-wrap">
        {types.map(t => (
          <button 
            key={t} 
            onClick={() => setFilter(t)} 
            className={`
              px-3 py-1 rounded-md text-[11px] border transition-all duration-200
              ${filter === t ? "bg-panel border-accent/40 text-white" : "bg-transparent border-line text-muted/40 hover:text-white hover:border-muted"}
            `}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-muted/40 text-[11px] align-self-center font-mono">{shown.length} memories</span>
      </div>
      <div className="flex flex-col">
        <div className="grid grid-cols-[120px_1fr_120px_120px_100px] px-3 py-2 border-b border-line">
          {["TYPE", "CONTENT", "IMPORTANCE", "SOURCE", "CREATED"].map(h => (
            <span key={h} className="text-muted/30 text-[10px] font-mono tracking-widest">{h}</span>
          ))}
        </div>
        {shown.map(m => (
          <div key={m.id} className="grid grid-cols-[120px_1fr_120px_120px_100px] p-3 border-b border-white/5 items-center hover:bg-panel/[0.02] transition-colors group">
            <Badge label={m.type} color={MEM_COLORS[m.type]} type="info" />
            <span className="text-muted text-[12px] pr-4 line-clamp-1 group-hover:text-white transition-colors">{m.content}</span>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-line max-w-[80px]">
                <div className="h-full rounded-full" style={{ width: `${m.importance * 100}%`, background: MEM_COLORS[m.type] ?? "var(--muted)" }} />
              </div>
              <span className="text-muted/70 text-[11px] font-mono">{m.importance}</span>
            </div>
            <span className="text-muted/40 text-[11px] font-mono">{m.source}</span>
            <span className="text-muted/30 text-[11px] font-mono">{m.ago}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ingest ───────────────────────────────────────────────────────────────────
function Ingest() {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full font-sans">
      <div className="flex gap-3">
        <Badge label="0 total" type="success" />
        <Badge label="0 completed" type="success" />
        <span className="ml-auto text-muted/30 text-[11px] font-mono">.pdf .txt .md .json .csv .yaml .toml .html .log +more</span>
      </div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false) }}
        className={`
          border-2 border-dashed rounded-card p-[60px_24px] flex flex-col items-center gap-3 transition-all duration-300
          ${dragging ? "border-accent bg-accent/5" : "border-line bg-transparent"}
        `}
      >
        <div className="text-muted text-3xl font-light">↑</div>
        <div className="text-white text-[13px] font-medium tracking-tight">Drop files here or click to browse</div>
        <div className="text-muted text-xs text-center max-w-[320px] leading-relaxed">Supported files, including PDFs, are chunked and processed into structured memories.</div>
      </div>
      <div className="text-muted/30 text-[13px] text-center mt-6 italic">No files ingested yet. Drop a supported file above to get started.</div>
    </div>
  );
}

// ─── Workers ─────────────────────────────────────────────────────────────────
function Workers() {
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? WORKERS : WORKERS.filter(w => w.status === filter);
  return (
    <div className="p-6 flex gap-0 h-full overflow-hidden font-sans">
      <div className="w-[360px] flex flex-col gap-3 border-r border-line pr-5 overflow-y-auto">
        <div className="flex gap-2 items-center">
          <input 
            placeholder="Search tasks..." 
            className="flex-1 bg-bg-elevated border border-line rounded-pill px-3 py-[7px] text-muted text-xs outline-none focus:border-accent/40 transition-colors" 
          />
          <span className="text-muted/40 text-[11px] font-mono">{shown.length}</span>
        </div>
        <div className="flex gap-2">
          {["all", "running", "done", "failed"].map(f => (
            <button 
              key={f} 
              onClick={() => setFilter(f)} 
              className={`
                px-3 py-1 rounded-md text-[11px] border transition-all duration-200
                ${filter === f ? "bg-panel border-accent/40 text-white" : "bg-transparent border-line text-muted/40 hover:text-white hover:border-muted"}
              `}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {shown.length === 0 && <div className="text-muted/40 text-[13px] text-center mt-8 italic">No workers found</div>}
        {shown.map(w => (
          <div key={w.id} className="bg-panel border border-line rounded-card p-4 hover:bg-panel-strong transition-colors group">
            <div className="flex items-center gap-2 mb-2">
              <Dot status={w.status} />
              <span className="text-white text-xs font-mono flex-1 group-hover:text-accent-2 transition-colors">{w.job}</span>
            </div>
            <div className="flex gap-3 items-center">
              <Badge label={w.slot} color={SLOT_ACCENT[w.slot] ?? SLOT_ACCENT.default} type="info" />
              <span className="text-muted/40 text-[11px] ml-auto font-mono">{w.elapsed}</span>
              <button className="text-[11px] px-2 py-1 rounded border border-line bg-transparent text-muted/40 hover:text-white hover:border-white transition-all">Cancel</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center bg-panel-row">
        <span className="text-muted/20 text-[13px] italic font-mono">Select a worker to view details</span>
      </div>
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks() {
  const STATUS_BADGE = { completed: "success", failed: "danger", dead_letter: "warn", running: "info" };
  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full font-sans">
      {TASKS.length === 0 ? (
        <div className="m-auto flex flex-col items-center gap-3">
          <div className="text-muted/30 text-[13px] font-mono italic">No tasks yet</div>
          <button className="btn btn-secondary !min-h-[40px] text-xs">Create Task</button>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[1fr_100px_80px_100px_100px] px-3 py-2 border-b border-line">
            {["JOB", "STATUS", "CREDITS", "MODEL", "TIME"].map(h => (
              <span key={h} className="text-muted/30 text-[10px] font-mono tracking-widest">{h}</span>
            ))}
          </div>
          {TASKS.map(t => (
            <div key={t.id} className="grid grid-cols-[1fr_100px_80px_100px_100px] p-3 border-b border-white/5 items-center hover:bg-panel/[0.02] transition-colors group">
              <span className="text-white text-[12px] font-mono group-hover:text-accent-2 transition-colors">{t.job}</span>
              <Badge label={t.status} type={STATUS_BADGE[t.status]} />
              <span className="text-muted/70 text-[11px] font-mono">{t.credits}</span>
              <span className="text-muted/40 text-[11px] font-mono">{t.model}</span>
              <span className="text-muted/30 text-[11px] font-mono">{t.ago}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cortex ───────────────────────────────────────────────────────────────────
const CORTEX_TYPE_COLOR = { "bulletin generated":"var(--accent-2)", "warmup succeeded":"var(--success)", "profile generated":"rgb(167, 139, 250)" };

function CortexTab({ agent }) {
  const [filter, setFilter] = useState("all");
  const filters = ["all", "bulletin", "maintenance", "health", "consolidation"];
  return (
    <div className="p-6 flex gap-0 h-full overflow-hidden font-sans">
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-5">
        <div className="flex items-center gap-2">
          {filters.map(f => (
            <button 
              key={f} 
              onClick={() => setFilter(f)} 
              className={`
                px-3 py-1 rounded-md text-[11px] border transition-all duration-200
                ${filter === f ? "bg-panel border-accent/40 text-white" : "bg-transparent border-line text-muted/40 hover:text-white hover:border-muted"}
              `}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <span className="ml-auto text-muted/30 text-[11px] font-mono italic">1-{CORTEX_LOG.length} of {CORTEX_LOG.length}</span>
        </div>
        <div className="flex flex-col">
          {CORTEX_LOG.map((e, i) => (
            <div key={i} className="grid grid-cols-[80px_160px_1fr_20px] items-center p-3 border-b border-white/5 gap-3 hover:bg-panel/[0.02] transition-colors group">
              <span className="text-muted/30 text-[11px] font-mono">{e.ago}</span>
              <Badge label={e.type} color={CORTEX_TYPE_COLOR[e.type] ?? "var(--muted)"} type="info" />
              <span className="text-muted text-[12px] group-hover:text-white transition-colors">{e.msg}</span>
              <span className="text-muted/30 group-hover:text-accent transition-colors">›</span>
            </div>
          ))}
        </div>
      </div>
      <div className="w-[320px] border-l border-line pl-5 flex flex-col gap-4">
        <div className="text-white text-sm font-semibold tracking-tight">Cortex</div>
        <div className="flex-1" />
        <div className="bg-panel border border-line rounded-card p-5 shadow-panel backdrop-blur-panel">
          <div className="text-white text-[13px] font-medium mb-1">Cortex chat</div>
          <div className="text-muted text-[12px] leading-relaxed mb-2 italic">System-level control for this agent: memory, tasks, worker inspection, and direct tool execution.</div>
          <div className="text-muted/30 text-[11px] mb-3 font-mono">No channel transcript is injected. Operating at full agent scope.</div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {["Run health check", "Audit memories", "Review workers", "Draft task spec"].map(a => (
              <button key={a} className="text-left p-2 rounded-md bg-bg-elevated border border-line text-muted/50 text-[11px] hover:text-white hover:border-muted transition-colors">{a}</button>
            ))}
          </div>
          <input 
            placeholder="Message the cortex..." 
            className="w-full bg-panel border border-line rounded-pill px-3 py-2 text-white text-[12px] outline-none focus:border-accent/40 transition-colors" 
          />
        </div>
      </div>
    </div>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────
function Skills({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full font-sans">
      <div className="flex gap-3 items-center">
        <button className="btn btn-secondary !min-h-[36px] text-xs">Browse Skills</button>
        <button className="px-4 py-[6px] rounded-pill border border-line bg-transparent text-muted/50 text-xs hover:text-white transition-colors">Installed (0)</button>
        <span className="ml-auto text-muted/40 text-[11px] font-mono hover:text-accent-2 cursor-pointer transition-colors text-link">skills.sh ↗</span>
      </div>
      <div className="flex gap-3 items-center">
        <input 
          placeholder="Search skills..." 
          className="flex-1 bg-bg-elevated border border-line rounded-pill px-3 py-2 text-muted text-xs outline-none focus:border-accent/40 transition-colors" 
        />
        {["All Time", "Trending", "Hot"].map(f => (
          <button key={f} className="px-3 py-[6px] rounded-pill border border-line bg-transparent text-muted/40 text-[11px] hover:text-white transition-colors">{f}</button>
        ))}
      </div>
      <div className="bg-panel border border-line rounded-card p-5 flex items-center gap-4 transition-all duration-300">
        <div className="flex-1">
          <div className="text-white text-[13px] font-medium mb-1">Install from GitHub</div>
          <div className="text-muted text-[12px] italic">Install any skill from a GitHub repository</div>
        </div>
        <input 
          placeholder="owner/repo or owner/repo/skill-name" 
          className="w-[280px] bg-panel border border-line rounded-pill px-3 py-[7px] text-white text-[12px] outline-none focus:border-accent/40 transition-colors font-mono" 
        />
        <button className="btn btn-primary !min-h-[36px] px-4 text-xs">↓ Install</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {SKILLS.map(s => (
          <div key={s.id} className="bg-panel border border-line rounded-card p-5 hover:bg-panel-strong transition-all duration-200 group">
            <div className="text-white text-[13px] font-bold mb-1 group-hover:text-accent transition-colors">{s.name}</div>
            <div className="text-muted/40 text-[11px] font-mono mb-2">{s.author}</div>
            <div className="text-muted text-[12px] leading-relaxed mb-4 italic line-clamp-2">{s.desc}</div>
            <div className="flex items-center">
              <span className="text-muted/30 text-[11px] font-mono">{s.installs} installs</span>
              <button className="ml-auto w-8 h-8 rounded-md bg-bg-elevated border border-line text-muted/50 text-sm flex items-center justify-center hover:text-white hover:border-white transition-all font-bold">↓</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cron ─────────────────────────────────────────────────────────────────────
function Cron({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full font-sans">
      <div className="flex gap-3 items-center">
        <Badge label={`${CRON_JOBS.length} total`} type="info" />
        <Badge label={`${CRON_JOBS.filter(j => j.status === "active").length} enabled`} type="success" />
        <Badge label="0 runs" type="muted" />
        <button className="ml-auto btn btn-primary !min-h-[36px] px-4 text-xs font-bold">+ New Job</button>
      </div>
      {CRON_JOBS.map(j => (
        <div key={j.id} className="bg-panel border border-line rounded-card p-5 hover:bg-panel-strong transition-all duration-200 group">
          <div className="flex items-center gap-3 mb-2">
            <Dot status={j.status} />
            <span className="text-white text-[13px] font-mono group-hover:text-accent transition-colors">{j.name}</span>
            <Badge label={j.status} type={j.status === "active" ? "success" : "muted"} />
            <div className="ml-auto flex gap-2">
              {["▶", "⚡", "✎", "✕"].map(a => (
                <button key={a} className="w-7 h-7 rounded border border-line bg-bg-elevated text-muted/40 text-[10px] flex items-center justify-center hover:text-white hover:border-white transition-all">{a}</button>
              ))}
            </div>
          </div>
          <div className="text-muted text-[12px] italic mb-3 leading-relaxed">{j.desc}</div>
          <div className="flex gap-4 items-center">
            <span className="text-muted/40 text-[11px] font-mono">{j.interval}</span>
            <span className="text-line">|</span>
            <span className="text-muted/40 text-[11px] font-mono uppercase">{j.type}</span>
          </div>
          <button className="mt-3 text-muted/40 text-[11px] hover:text-white transition-colors flex items-center gap-1 font-mono">
            › Show history
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Config ───────────────────────────────────────────────────────────────────
function Config() {
  const [active, setActive] = useState("Soul");
  return (
    <div className="flex h-full overflow-hidden font-sans">
      <div className="w-[180px] border-r border-line py-4 overflow-y-auto flex-shrink-0 bg-panel-row">
        {Object.entries(CONFIG_SECTIONS).map(([section, items]) => (
          <div key={section} className="mb-4">
            <div className="text-muted/30 text-[9px] font-mono tracking-[0.2em] px-4 pb-2 text-uppercase opacity-80">{section}</div>
            {items.map(item => (
              <button 
                key={item} 
                onClick={() => setActive(item)} 
                className={`
                  block w-full text-left px-4 py-[7px] text-[12px] transition-all duration-200
                  ${active === item ? "bg-bg-elevated text-white font-medium border-r-2 border-accent" : "text-muted/50 hover:text-white hover:bg-panel/[0.02]"}
                `}
              >
                {item}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-panel-row">
          <span className="text-white text-[13px] font-medium tracking-tight">{active}</span>
          {active === "Soul" && <span className="text-muted/40 text-[11px] font-mono italic opacity-60">SOUL.md</span>}
          <div className="ml-auto flex gap-2">
            <button className="px-3 py-1 rounded-md bg-bg-elevated border border-line text-muted text-[11px] hover:text-white hover:border-white transition-all font-medium">Edit</button>
            <button className="px-3 py-1 rounded-md bg-transparent border border-line text-muted/50 text-[11px] hover:text-white transition-all">Preview</button>
            <span className="text-muted/20 text-[10px] align-self-center font-mono italic ml-2">Cmd+S to save</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-panel">
          <pre className="text-muted text-[12px] font-mono leading-[1.8] whitespace-pre-wrap">{SOUL_MD}</pre>
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function AgentApp() {
  const [activeAgent, setActiveAgent] = useState(AGENTS[0].id);
  const [activeTab, setActiveTab] = useState("Overview");

  const agent = AGENTS.find(a => a.id === activeAgent) ?? AGENTS[0];
  const ac = accent(agent.slot);

  const renderTab = () => {
    switch (activeTab) {
      case "Overview": return <Overview agent={agent} />;
      case "Chat": return <Chat agent={agent} />;
      case "Channels": return <Channels agent={agent} />;
      case "Memories": return <Memories agent={agent} />;
      case "Ingest": return <Ingest />;
      case "Workers": return <Workers />;
      case "Tasks": return <Tasks />;
      case "Cortex": return <CortexTab agent={agent} />;
      case "Skills": return <Skills agent={agent} />;
      case "Cron": return <Cron agent={agent} />;
      case "Config": return <Config />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text selection:bg-accent/20">
      <AgentSidebar agents={AGENTS} activeAgent={activeAgent} setActiveAgent={id => { setActiveAgent(id); setActiveTab("Overview"); }} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Agent header */}
        <div className="px-6 py-[12px] border-b border-line flex items-center gap-3 flex-shrink-0 bg-panel backdrop-blur-panel">
          <span className="text-white text-sm font-bold tracking-tight">{agent.name}</span>
          <Dot status={agent.status} />
          <button className="ml-auto py-1 px-3 rounded-md bg-bg-elevated border border-line text-muted/40 text-[11px] hover:text-accent hover:border-accent/30 transition-all">Delete</button>
        </div>
        <AgentTabBar active={activeTab} setActive={setActiveTab} agentAccent={ac} />
        <div className="flex-1 overflow-hidden relative">
          <div className="app-accent-halo absolute inset-0 pointer-events-none opacity-[0.03]" />
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
