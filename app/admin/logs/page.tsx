"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/ui";

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
                <div className="p-4">
                  <EmptyState title="No files found" />
                </div>
              ) : (
                files.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => loadFile(f)}
                    className={`btn btn-secondary w-full !min-h-[44px] justify-start rounded-none border-x-0 border-t-0 px-4 text-body-sm font-mono break-all ${
                      selected === f
                        ? "bg-accent/10 text-accent border-l-2 border-l-accent hover:bg-accent/10 hover:text-accent"
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
              <div className="h-full p-6 flex items-center justify-center">
                <EmptyState
                  title="Select a log file"
                  description="Choose a log file from the left panel to view its contents."
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
