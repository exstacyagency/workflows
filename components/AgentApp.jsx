"use client";
import { useState } from "react";

// ─── Fonts via CSS ────────────────────────────────────────────────────────────
const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #__next { height: 100%; background: #0a0a0a; color: #c8c8c8; font-family: 'IBM Plex Sans', sans-serif; }
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
  button { cursor: pointer; font-family: inherit; }
  input, textarea, select { font-family: inherit; }
`;

// ─── Mock Data ────────────────────────────────────────────────────────────────
const AGENTS = [
  { id: "orchestrator", name: "Orchestrator", status: "online", channels: 8, memories: 142, model: "haiku-4.5", slot: "orchestrator" },
  { id: "research",     name: "Research",     status: "online", channels: 4, memories: 89,  model: "sonnet-4.6", slot: "worker_a" },
  { id: "creative",     name: "Creative",     status: "idle",   channels: 4, memories: 61,  model: "sonnet-4.6", slot: "worker_b" },
  { id: "cortex",       name: "Cortex",       status: "idle",   channels: 0, memories: 310, model: "haiku-4.5",  slot: "cortex"  },
];

const SLOT_ACCENT = {
  orchestrator: "#4ade80",
  worker_a:     "#38bdf8",
  worker_b:     "#fb923c",
  cortex:       "#a78bfa",
  default:      "#6b7280",
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
const accent = (slot) => SLOT_ACCENT[slot] ?? SLOT_ACCENT.default;

const Badge = ({ label, color }) => (
  <span style={{
    fontSize: 10, padding: "2px 7px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace",
    background: (color ?? "#6b7280") + "18", color: color ?? "#6b7280",
    border: `1px solid ${(color ?? "#6b7280")}33`, letterSpacing: 0.5,
  }}>{label}</span>
);

const STATUS = { online:"#4ade80", idle:"#fbbf24", offline:"#374151", active:"#4ade80", disabled:"#374151", running:"#38bdf8", completed:"#4ade80", failed:"#f87171", dead_letter:"#f59e0b" };

function Dot({ status }) {
  const c = STATUS[status] ?? "#374151";
  return <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background:c, boxShadow: status==="online"||status==="active"||status==="running" ? `0 0 6px ${c}` : "none" }} />;
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ agents, activeAgent, setActiveAgent }) {
  return (
    <div style={{ width:52, background:"#0d0d0d", borderRight:"1px solid #1a1a1a", display:"flex", flexDirection:"column", alignItems:"center", padding:"16px 0", gap:6, flexShrink:0 }}>
      <div style={{ width:28, height:28, borderRadius:6, background:"linear-gradient(135deg,#4ade80,#38bdf8)", marginBottom:12 }} />
      {agents.map(a => (
        <button key={a.id} onClick={() => setActiveAgent(a.id)} title={a.name} style={{
          width:36, height:36, borderRadius:8, border:`1px solid ${activeAgent===a.id ? accent(a.slot)+"66" : "transparent"}`,
          background: activeAgent===a.id ? accent(a.slot)+"15" : "transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          color: activeAgent===a.id ? accent(a.slot) : "#444",
          fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:600,
          transition:"all 0.15s",
        }}>
          {a.name[0]}
        </button>
      ))}
      <button style={{ width:36, height:36, borderRadius:8, border:"1px solid #1a1a1a", background:"transparent", color:"#333", fontSize:18, marginTop:"auto" }}>+</button>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
function TabBar({ active, setActive, agentAccent }) {
  return (
    <div style={{ display:"flex", borderBottom:"1px solid #1a1a1a", padding:"0 24px", gap:0, flexShrink:0 }}>
      {TABS.map(t => (
        <button key={t} onClick={() => setActive(t)} style={{
          padding:"12px 14px 10px", fontSize:12, fontFamily:"'IBM Plex Sans',sans-serif",
          background:"none", border:"none", borderBottom:`2px solid ${active===t ? agentAccent : "transparent"}`,
          color: active===t ? "#e5e5e5" : "#555", transition:"color 0.15s",
          marginBottom:-1,
        }}>{t}</button>
      ))}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────
function Overview({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div style={{ padding:28, display:"flex", flexDirection:"column", gap:24, overflow:"auto", height:"100%" }}>
      <div>
        <h1 style={{ fontSize:28, fontWeight:300, color:"#e5e5e5", fontFamily:"'IBM Plex Sans',sans-serif", letterSpacing:-0.5 }}>{agent.name}</h1>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
          <Dot status={agent.status} />
          <span style={{ color:"#555", fontSize:12 }}>{agent.status === "online" ? "Online" : "Idle"}</span>
          {agent.channels > 0 && <span style={{ color:"#444", fontSize:12 }}>{agent.channels} channel{agent.channels!==1?"s":""}</span>}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        {[
          { label:"Memories", value:agent.memories },
          { label:"Model", value:agent.model },
          { label:"Slot", value:agent.slot },
        ].map(s => (
          <div key={s.label} style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px 20px" }}>
            <div style={{ color:"#444", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>{s.label}</div>
            <div style={{ color:"#e5e5e5", fontSize:16, fontFamily:"'IBM Plex Mono',monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"20px 24px" }}>
        <div style={{ color:"#444", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1.5, marginBottom:16 }}>MEMORY GROWTH · LAST 30 DAYS</div>
        <svg viewBox="0 0 600 80" style={{ width:"100%", height:80 }}>
          <polyline points="0,70 100,65 200,55 300,50 400,40 500,25 580,20" fill="none" stroke={ac} strokeWidth="1.5" opacity="0.6" />
          <polyline points="0,70 100,65 200,55 300,50 400,40 500,25 580,20 580,80 0,80" fill={ac} opacity="0.06" />
          {[[580,20]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r={3} fill={ac} />)}
        </svg>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"20px 24px" }}>
          <div style={{ color:"#444", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1.5, marginBottom:16 }}>ACTIVITY HEATMAP</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(24,1fr)", gap:2 }}>
            {Array.from({length:7*24}).map((_,i) => (
              <div key={i} style={{ height:8, borderRadius:1, background: Math.random()>0.85 ? ac+"99" : Math.random()>0.6 ? "#1c1c1c" : "#141414" }} />
            ))}
          </div>
        </div>
        <div style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"20px 24px" }}>
          <div style={{ color:"#444", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1.5, marginBottom:16 }}>PROCESS ACTIVITY</div>
          <svg viewBox="0 0 300 80" style={{ width:"100%", height:80 }}>
            <polyline points="0,75 60,72 120,60 180,65 240,40 290,20" fill="none" stroke={ac} strokeWidth="1.5" opacity="0.6" />
            {[[290,20]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r={3} fill={ac} />)}
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
    setMsgs(m => [...m, { role:"user", text:input }, { role:"agent", text:`[${agent.name}] acknowledged: "${input}"` }]);
    setInput("");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"24px 28px", display:"flex", flexDirection:"column", gap:12 }}>
        {msgs.length === 0 && (
          <div style={{ margin:"auto", color:"#333", fontSize:13 }}>Start a conversation with {agent.name}</div>
        )}
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent: m.role==="user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth:"60%", padding:"10px 14px", borderRadius:8, fontSize:13,
              background: m.role==="user" ? ac+"22" : "#161616",
              border:`1px solid ${m.role==="user" ? ac+"44" : "#1c1c1c"}`,
              color: m.role==="user" ? "#e5e5e5" : "#aaa",
            }}>{m.text}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:"16px 24px", borderTop:"1px solid #1a1a1a", display:"flex", gap:10 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder={`Message ${agent.name}...`}
          style={{ flex:1, background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"10px 14px", color:"#e5e5e5", fontSize:13, outline:"none" }} />
        <button onClick={send} style={{ width:38, height:38, borderRadius:"50%", background:ac, border:"none", color:"#000", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>↑</button>
      </div>
    </div>
  );
}

// ─── Channels ────────────────────────────────────────────────────────────────
function Channels({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      <input placeholder="Search channels..." style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:6, padding:"8px 12px", color:"#aaa", fontSize:12, outline:"none", width:"100%" }} />
      {CHANNELS.map(ch => (
        <div key={ch.id} style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px 20px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <span style={{ color:"#e5e5e5", fontSize:13, fontFamily:"'IBM Plex Mono',monospace", flex:1 }}>{ch.name}</span>
            <Dot status={ch.active?"online":"offline"} />
            <span style={{ color:"#333", fontSize:11 }}>{ch.ago}</span>
          </div>
          <Badge label={ch.platform} color={ac} />
          <p style={{ color:"#444", fontSize:12, marginTop:10 }}>{ch.preview}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Memories ────────────────────────────────────────────────────────────────
const MEM_COLORS = { preference:"#a78bfa", fact:"#38bdf8", decision:"#fb923c", goal:"#4ade80", observation:"#fbbf24", event:"#f87171", identity:"#e879f9", todo:"#94a3b8" };

function Memories({ agent }) {
  const [filter, setFilter] = useState("all");
  const types = ["all","fact","preference","decision","identity","event","observation","goal","todo"];
  const shown = filter==="all" ? MEMORIES : MEMORIES.filter(m=>m.type===filter);

  return (
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <input placeholder="Search memories..." style={{ flex:1, background:"#111", border:"1px solid #1c1c1c", borderRadius:6, padding:"8px 12px", color:"#aaa", fontSize:12, outline:"none" }} />
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {types.map(t => (
          <button key={t} onClick={()=>setFilter(t)} style={{
            padding:"4px 10px", borderRadius:5, fontSize:11, border:`1px solid ${filter===t?"#333":"#1a1a1a"}`,
            background: filter===t ? "#1c1c1c" : "transparent", color: filter===t ? "#e5e5e5" : "#444",
          }}>{t}</button>
        ))}
        <span style={{ marginLeft:"auto", color:"#444", fontSize:11, alignSelf:"center" }}>{shown.length} memories</span>
      </div>
      <div style={{ display:"flex", gap:0, flexDirection:"column" }}>
        <div style={{ display:"grid", gridTemplateColumns:"120px 1fr 120px 120px 100px", padding:"6px 12px", borderBottom:"1px solid #1a1a1a" }}>
          {["TYPE","CONTENT","IMPORTANCE","SOURCE","CREATED"].map(h => (
            <span key={h} style={{ color:"#333", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1 }}>{h}</span>
          ))}
        </div>
        {shown.map(m => (
          <div key={m.id} style={{ display:"grid", gridTemplateColumns:"120px 1fr 120px 120px 100px", padding:"12px", borderBottom:"1px solid #141414", alignItems:"center" }}>
            <Badge label={m.type} color={MEM_COLORS[m.type]} />
            <span style={{ color:"#aaa", fontSize:12, paddingRight:16 }}>{m.content}</span>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ flex:1, height:4, borderRadius:2, background:"#1a1a1a", maxWidth:80 }}>
                <div style={{ width:`${m.importance*100}%`, height:"100%", borderRadius:2, background: MEM_COLORS[m.type] ?? "#444" }} />
              </div>
              <span style={{ color:"#555", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>{m.importance}</span>
            </div>
            <span style={{ color:"#444", fontSize:11 }}>{m.source}</span>
            <span style={{ color:"#333", fontSize:11 }}>{m.ago}</span>
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
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      <div style={{ display:"flex", gap:10 }}>
        <Badge label="0 total" color="#4ade80" />
        <Badge label="0 completed" color="#4ade80" />
        <span style={{ marginLeft:"auto", color:"#333", fontSize:11 }}>.pdf .txt .md .json .csv .yaml .toml .html .log +more</span>
      </div>
      <div
        onDragOver={e=>{e.preventDefault();setDragging(true)}}
        onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false)}}
        style={{
          border:`1px dashed ${dragging?"#4ade80":"#1c1c1c"}`, borderRadius:8, padding:"60px 24px",
          display:"flex", flexDirection:"column", alignItems:"center", gap:12, background: dragging?"#4ade8006":"transparent",
          transition:"all 0.15s",
        }}
      >
        <div style={{ color:"#333", fontSize:24 }}>↑</div>
        <div style={{ color:"#aaa", fontSize:13 }}>Drop files here or click to browse</div>
        <div style={{ color:"#444", fontSize:12 }}>Supported files, including PDFs, are chunked and processed into structured memories</div>
      </div>
      <div style={{ color:"#333", fontSize:13, textAlign:"center", marginTop:24 }}>No files ingested yet. Drop a supported file above to get started.</div>
    </div>
  );
}

// ─── Workers ─────────────────────────────────────────────────────────────────
function Workers() {
  const [filter, setFilter] = useState("all");
  const shown = filter==="all" ? WORKERS : WORKERS.filter(w=>w.status===filter);
  return (
    <div style={{ padding:24, display:"flex", gap:0, height:"100%", overflow:"hidden" }}>
      <div style={{ width:360, display:"flex", flexDirection:"column", gap:12, borderRight:"1px solid #1a1a1a", paddingRight:20, overflowY:"auto" }}>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input placeholder="Search tasks..." style={{ flex:1, background:"#111", border:"1px solid #1c1c1c", borderRadius:6, padding:"7px 10px", color:"#aaa", fontSize:12, outline:"none" }} />
          <span style={{ color:"#444", fontSize:11 }}>{shown.length}</span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {["all","running","done","failed"].map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{ padding:"4px 10px", borderRadius:5, fontSize:11, border:`1px solid ${filter===f?"#333":"#1a1a1a"}`, background:filter===f?"#1c1c1c":"transparent", color:filter===f?"#e5e5e5":"#444" }}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>
          ))}
        </div>
        {shown.length===0 && <div style={{ color:"#333", fontSize:13, textAlign:"center", marginTop:32 }}>No workers found</div>}
        {shown.map(w => (
          <div key={w.id} style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <Dot status={w.status} />
              <span style={{ color:"#e5e5e5", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", flex:1 }}>{w.job}</span>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <Badge label={w.slot} color={SLOT_ACCENT[w.slot]??SLOT_ACCENT.default} />
              <span style={{ color:"#444", fontSize:11, marginLeft:"auto" }}>{w.elapsed}</span>
              <button style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#555" }}>Cancel</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ color:"#2a2a2a", fontSize:13 }}>Select a worker to view details</span>
      </div>
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks() {
  const STATUS_BADGE = { completed:"#4ade80", failed:"#f87171", dead_letter:"#f59e0b", running:"#38bdf8" };
  return (
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      {TASKS.length === 0 ? (
        <div style={{ margin:"auto", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <div style={{ color:"#333", fontSize:13 }}>No tasks yet</div>
          <button style={{ padding:"8px 20px", borderRadius:6, background:"#a78bfa22", border:"1px solid #a78bfa44", color:"#a78bfa", fontSize:12 }}>Create Task</button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 100px 80px 100px 100px", padding:"6px 12px", borderBottom:"1px solid #1a1a1a" }}>
            {["JOB","STATUS","CREDITS","MODEL","TIME"].map(h=>(
              <span key={h} style={{ color:"#333", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1 }}>{h}</span>
            ))}
          </div>
          {TASKS.map(t=>(
            <div key={t.id} style={{ display:"grid", gridTemplateColumns:"1fr 100px 80px 100px 100px", padding:"12px", borderBottom:"1px solid #141414", alignItems:"center" }}>
              <span style={{ color:"#aaa", fontSize:12, fontFamily:"'IBM Plex Mono',monospace" }}>{t.job}</span>
              <Badge label={t.status} color={STATUS_BADGE[t.status]} />
              <span style={{ color:"#555", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>{t.credits}</span>
              <span style={{ color:"#444", fontSize:11 }}>{t.model}</span>
              <span style={{ color:"#333", fontSize:11 }}>{t.ago}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cortex ───────────────────────────────────────────────────────────────────
const CORTEX_TYPE_COLOR = { "bulletin generated":"#38bdf8", "warmup succeeded":"#4ade80", "profile generated":"#a78bfa" };

function CortexTab({ agent }) {
  const [filter, setFilter] = useState("all");
  const filters = ["all","bulletin","maintenance","health","consolidation"];
  return (
    <div style={{ padding:24, display:"flex", gap:0, height:"100%", overflow:"hidden" }}>
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:12, overflowY:"auto", paddingRight:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {filters.map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{ padding:"4px 10px", borderRadius:5, fontSize:11, border:`1px solid ${filter===f?"#333":"#1a1a1a"}`, background:filter===f?"#1c1c1c":"transparent", color:filter===f?"#e5e5e5":"#444" }}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>
          ))}
          <span style={{ marginLeft:"auto", color:"#333", fontSize:11 }}>1-{CORTEX_LOG.length} of {CORTEX_LOG.length}</span>
        </div>
        {CORTEX_LOG.map((e,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"80px 160px 1fr 20px", alignItems:"center", padding:"10px 12px", borderBottom:"1px solid #141414", gap:12 }}>
            <span style={{ color:"#333", fontSize:11 }}>{e.ago}</span>
            <Badge label={e.type} color={CORTEX_TYPE_COLOR[e.type] ?? "#6b7280"} />
            <span style={{ color:"#666", fontSize:12 }}>{e.msg}</span>
            <span style={{ color:"#333" }}>›</span>
          </div>
        ))}
      </div>
      <div style={{ width:320, borderLeft:"1px solid #1a1a1a", paddingLeft:20, display:"flex", flexDirection:"column", gap:16 }}>
        <div style={{ color:"#e5e5e5", fontSize:14, fontWeight:500 }}>Cortex</div>
        <div style={{ flex:1 }} />
        <div style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px" }}>
          <div style={{ color:"#e5e5e5", fontSize:13, fontWeight:500, marginBottom:6 }}>Cortex chat</div>
          <div style={{ color:"#555", fontSize:12, lineHeight:1.6, marginBottom:8 }}>System-level control for this agent: memory, tasks, worker inspection, and direct tool execution.</div>
          <div style={{ color:"#333", fontSize:11, marginBottom:12 }}>No channel transcript is injected. Operating at full agent scope.</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
            {["Run health check","Audit memories","Review workers","Draft task spec"].map(a=>(
              <button key={a} style={{ padding:"7px 10px", borderRadius:5, background:"#161616", border:"1px solid #1c1c1c", color:"#555", fontSize:11, textAlign:"left" }}>{a}</button>
            ))}
          </div>
          <input placeholder="Message the cortex..." style={{ width:"100%", background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:6, padding:"8px 10px", color:"#aaa", fontSize:12, outline:"none" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────
function Skills({ agent }) {
  const ac = accent(agent.slot);
  return (
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <button style={{ padding:"6px 14px", borderRadius:6, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#e5e5e5", fontSize:12 }}>Browse Registry</button>
        <button style={{ padding:"6px 14px", borderRadius:6, background:"transparent", border:"1px solid #1a1a1a", color:"#555", fontSize:12 }}>Installed (0)</button>
        <span style={{ marginLeft:"auto", color:"#444", fontSize:11 }}>skills.sh ↗</span>
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <input placeholder="Search skills..." style={{ flex:1, background:"#111", border:"1px solid #1c1c1c", borderRadius:6, padding:"8px 12px", color:"#aaa", fontSize:12, outline:"none" }} />
        {["All Time","Trending","Hot"].map(f=>(
          <button key={f} style={{ padding:"6px 12px", borderRadius:6, background:"transparent", border:"1px solid #1a1a1a", color:"#444", fontSize:11 }}>{f}</button>
        ))}
      </div>
      <div style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px 20px", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ color:"#e5e5e5", fontSize:13, marginBottom:4 }}>Install from GitHub</div>
          <div style={{ color:"#555", fontSize:12 }}>Install any skill from a GitHub repository</div>
        </div>
        <input placeholder="owner/repo or owner/repo/skill-name" style={{ width:280, background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:6, padding:"7px 12px", color:"#aaa", fontSize:12, outline:"none" }} />
        <button style={{ padding:"7px 16px", borderRadius:6, background:ac+"22", border:`1px solid ${ac}44`, color:ac, fontSize:12 }}>↓ Install</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {SKILLS.map(s=>(
          <div key={s.id} style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px 20px" }}>
            <div style={{ color:"#e5e5e5", fontSize:13, fontWeight:500, marginBottom:4 }}>{s.name}</div>
            <div style={{ color:"#444", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>{s.author}</div>
            <div style={{ color:"#666", fontSize:12, lineHeight:1.5, marginBottom:12 }}>{s.desc}</div>
            <div style={{ display:"flex", alignItems:"center" }}>
              <span style={{ color:"#333", fontSize:11 }}>{s.installs} installs</span>
              <button style={{ marginLeft:"auto", width:28, height:28, borderRadius:5, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#555", fontSize:14 }}>↓</button>
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
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:16, overflow:"auto", height:"100%" }}>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <Badge label={`${CRON_JOBS.length} total`} color="#6b7280" />
        <Badge label={`${CRON_JOBS.filter(j=>j.status==="active").length} enabled`} color="#4ade80" />
        <Badge label="0 runs" color="#6b7280" />
        <button style={{ marginLeft:"auto", padding:"6px 14px", borderRadius:6, background:ac+"22", border:`1px solid ${ac}44`, color:ac, fontSize:12 }}>+ New Job</button>
      </div>
      {CRON_JOBS.map(j=>(
        <div key={j.id} style={{ background:"#111", border:"1px solid #1c1c1c", borderRadius:8, padding:"16px 20px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <Dot status={j.status} />
            <span style={{ color:"#e5e5e5", fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>{j.name}</span>
            <Badge label={j.status} color={STATUS[j.status]} />
            <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
              {["▶","⚡","✎","✕"].map(a=><button key={a} style={{ width:26, height:26, borderRadius:4, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#444", fontSize:12 }}>{a}</button>)}
            </div>
          </div>
          <div style={{ color:"#555", fontSize:12, marginBottom:8 }}>{j.desc}</div>
          <div style={{ display:"flex", gap:16 }}>
            <span style={{ color:"#333", fontSize:11 }}>{j.interval}</span>
            <span style={{ color:"#333", fontSize:11 }}>·</span>
            <span style={{ color:"#333", fontSize:11 }}>{j.type}</span>
          </div>
          <button style={{ marginTop:10, color:"#444", fontSize:11, background:"none", border:"none" }}>› Show history</button>
        </div>
      ))}
    </div>
  );
}

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_SECTIONS = {
  IDENTITY: ["Soul","Identity","User"],
  CONFIGURATION: ["Model Routing","Tuning","Compaction","Cortex","Coalesce","Memory Persistence","Browser","Sandbox"],
};

function Config() {
  const [active, setActive] = useState("Soul");
  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      <div style={{ width:180, borderRight:"1px solid #1a1a1a", padding:"16px 0", overflowY:"auto", flexShrink:0 }}>
        {Object.entries(CONFIG_SECTIONS).map(([section, items])=>(
          <div key={section} style={{ marginBottom:16 }}>
            <div style={{ color:"#333", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:2, padding:"0 16px 6px", textTransform:"uppercase" }}>{section}</div>
            {items.map(item=>(
              <button key={item} onClick={()=>setActive(item)} style={{
                display:"block", width:"100%", textAlign:"left", padding:"7px 16px",
                background: active===item ? "#1c1c1c" : "transparent",
                border:"none", color: active===item ? "#e5e5e5" : "#555", fontSize:12,
              }}>{item}</button>
            ))}
          </div>
        ))}
      </div>
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 24px", borderBottom:"1px solid #1a1a1a" }}>
          <span style={{ color:"#e5e5e5", fontSize:13 }}>{active}</span>
          {active==="Soul" && <span style={{ color:"#444", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>SOUL.md</span>}
          <div style={{ marginLeft:"auto", display:"flex", gap:10 }}>
            <button style={{ padding:"4px 12px", borderRadius:5, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#aaa", fontSize:11 }}>Edit</button>
            <button style={{ padding:"4px 12px", borderRadius:5, background:"transparent", border:"1px solid #1a1a1a", color:"#555", fontSize:11 }}>Preview</button>
            <span style={{ color:"#333", fontSize:11, alignSelf:"center" }}>Cmd+S to save</span>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:24 }}>
          <pre style={{ color:"#6b7280", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{SOUL_MD}</pre>
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function AgentApp() {
  const [activeAgent, setActiveAgent] = useState(AGENTS[0].id);
  const [activeTab, setActiveTab]     = useState("Overview");

  const agent = AGENTS.find(a=>a.id===activeAgent) ?? AGENTS[0];
  const ac = accent(agent.slot);

  const renderTab = () => {
    switch(activeTab) {
      case "Overview":  return <Overview agent={agent} />;
      case "Chat":      return <Chat agent={agent} />;
      case "Channels":  return <Channels agent={agent} />;
      case "Memories":  return <Memories agent={agent} />;
      case "Ingest":    return <Ingest />;
      case "Workers":   return <Workers />;
      case "Tasks":     return <Tasks />;
      case "Cortex":    return <CortexTab agent={agent} />;
      case "Skills":    return <Skills agent={agent} />;
      case "Cron":      return <Cron agent={agent} />;
      case "Config":    return <Config />;
      default:          return null;
    }
  };

  return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"#0a0a0a" }}>
        <Sidebar agents={AGENTS} activeAgent={activeAgent} setActiveAgent={id=>{setActiveAgent(id);setActiveTab("Overview");}} />
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Agent header */}
          <div style={{ padding:"12px 24px", borderBottom:"1px solid #1a1a1a", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
            <span style={{ color:"#e5e5e5", fontSize:14, fontWeight:500 }}>{agent.name}</span>
            <Dot status={agent.status} />
            <button style={{ marginLeft:"auto", padding:"4px 12px", borderRadius:5, background:"#1c1c1c", border:"1px solid #2a2a2a", color:"#555", fontSize:11 }}>Delete</button>
          </div>
          <TabBar active={activeTab} setActive={setActiveTab} agentAccent={ac} />
          <div style={{ flex:1, overflow:"hidden" }}>
            {renderTab()}
          </div>
        </div>
      </div>
    </>
  );
}
