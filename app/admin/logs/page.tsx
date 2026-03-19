"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

export default function LogsPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState("");

  useEffect(() => {
    fetch("/api/admin/logs")
      .then((r) => r.json())
      .then((d) => setFiles(d.files || []));
  }, []);

  const loadFile = (filename: string) => {
    setSelected(filename);
    fetch(`/api/admin/logs?file=${filename}`)
      .then((r) => r.text())
      .then((text) => {
        try {
          const parsed = JSON.parse(text);
          setContent(JSON.stringify(parsed, null, 2));
        } catch {
          setContent(text);
        }
      });
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Victora Logs"
          description={`${files.length} log file${files.length === 1 ? "" : "s"} available`}
        />

        <div className="rounded-card border border-line overflow-hidden flex" style={{ height: "70vh" }}>
          <div className="w-72 shrink-0 border-r border-line flex flex-col">
            <div className="px-4 py-3 border-b border-line bg-panel">
              <p className="text-label font-mono text-muted uppercase tracking-widest">Log Files</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {files.length === 0 ? (
                <p className="px-4 py-6 text-body-sm font-mono text-muted uppercase tracking-widest opacity-40 text-center">
                  No files found
                </p>
              ) : (
                files.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => loadFile(f)}
                    className={`w-full text-left px-4 py-3 border-b border-line/40 transition-colors text-body-sm font-mono break-all ${
                      selected === f
                        ? "bg-accent/10 text-accent border-l-2 border-l-accent"
                        : "text-muted hover:bg-panel hover:text-white"
                    }`}
                  >
                    <span className="mr-2">{f.startsWith("request-") ? "↑" : "↓"}</span>
                    {f}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-bg-elevated">
            {content ? (
              <pre className="p-6 text-body-sm font-mono text-text leading-relaxed whitespace-pre-wrap break-words">
                {content}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-body-sm font-mono text-muted uppercase tracking-widest opacity-40">
                  ← Select a log file to view
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
