// app/(app)/projects/CreateProjectButton.tsx
"use client";

import { useState } from "react";

export default function CreateProjectButton() {
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    
    try {
      // Add timestamp to ensure uniqueness
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name: `Project ${timestamp}`,
          description: "Created from Studio UI",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("[CreateProjectButton] Failed:", res.status, body);
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      const project = await res.json();
      console.log("[CreateProjectButton] Created:", project.id);
      
      window.location.href = `/projects/${project.id}`;
      
    } catch (error: any) {
      console.error("[CreateProjectButton] Error:", error);
      setLoading(false);
      alert(`Failed to create project: ${error.message}`);
    }
  }

  return (
    <button 
      onClick={handleCreate}
      disabled={loading}
      className="inline-flex items-center px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
    >
      {loading ? "Creating…" : "Create Project"}
    </button>
  );
}