"use client";

import { useEffect, useState } from "react";

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
    <div style={{ display: "flex", height: "100vh", fontFamily: "monospace", fontSize: "12px" }}>
      <div
        style={{
          width: "400px",
          borderRight: "1px solid #ddd",
          overflow: "auto",
          background: "#f9f9f9",
        }}
      >
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #ddd",
            background: "#fff",
            position: "sticky",
            top: 0,
          }}
        >
          <h2 style={{ margin: 0 }}>Anthropic Logs</h2>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: "11px" }}>
            {files.length} files
          </p>
        </div>
        {files.map((f) => (
          <div
            key={f}
            onClick={() => loadFile(f)}
            style={{
              padding: "12px 16px",
              cursor: "pointer",
              background: selected === f ? "#e3f2fd" : "transparent",
              borderBottom: "1px solid #eee",
              wordBreak: "break-all",
            }}
          >
            <div style={{ fontWeight: selected === f ? "bold" : "normal" }}>
              {f.startsWith("request-") ? "📤 " : "📥 "}
              {f}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: "20px",
        }}
      >
        {content ? (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {content}
          </pre>
        ) : (
          <div style={{ color: "#888", textAlign: "center", marginTop: "100px" }}>
            ← Select a log file to view
          </div>
        )}
      </div>
    </div>
  );
}
