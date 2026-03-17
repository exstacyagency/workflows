"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CreateProjectButton from "@/app/(app)/projects/CreateProjectButton";

type Project = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        throw new Error("Failed to load projects");
      }
      const data = (await res.json()) as Project[];
      setProjects(data || []);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create project");
      }

      // Clear form and reload projects
      setName("");
      setDescription("");
      await loadProjects();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <section className="rounded-card border border-line bg-panel p-6 flex flex-col gap-2 shadow-panel backdrop-blur-panel">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">Projects</h1>
            <p className="text-sm text-muted mt-1 italic max-w-2xl">
              Create and manage your projects. Each project flows through the full research → script → storyboard → video pipeline.
            </p>
          </div>
        </div>
        {error && (
          <p className="text-xs text-danger font-mono">
            {error}
          </p>
        )}
        <div className="pt-2">
          <CreateProjectButton />
        </div>
      </section>

      {/* New Project form */}
      <section className="rounded-card border border-line bg-panel p-5 space-y-4 shadow-panel backdrop-blur-panel">
        <h2 className="text-sm font-semibold text-white tracking-tight uppercase">
          New Project
        </h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="space-y-2">
            <label className="card-label">
              Name <span className="text-danger">*</span>
            </label>
            <input
              className="w-full rounded-pill border border-line bg-panel px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ClearGlow Acne Serum Launch"
            />
          </div>
          <div className="space-y-2">
            <label className="card-label">
              Description
            </label>
            <textarea
              className="w-full rounded-card border border-line bg-panel px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description to remind you what this project is about."
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="btn btn-primary !min-h-[36px] px-6 text-xs font-bold shadow-[0_0_15px_rgba(232,209,122,0.15)]"
          >
            {creating ? "Creating…" : "Create Project"}
          </button>
        </form>
      </section>

      {/* Projects list */}
      <section className="rounded-card border border-line bg-panel p-5 space-y-4 shadow-panel backdrop-blur-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white tracking-tight uppercase">
            Existing Projects
          </h2>
          <button
            onClick={loadProjects}
            disabled={loading}
            className="btn btn-secondary !min-h-[32px] px-4 text-[10px]"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {projects.length === 0 && !loading && (
          <p className="text-sm text-muted italic text-center py-6 border border-dashed border-line rounded-card">
            No projects yet. Create your first project using the form above.
          </p>
        )}
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex cursor-pointer items-center justify-between rounded-card border border-line bg-panel px-5 py-4"
            >
              <div className="space-y-1.5">
                <div className="text-sm font-bold text-white tracking-tight">
                  {project.name}
                </div>
                {project.description && (
                  <div className="text-xs text-muted/80 italic">
                    {project.description}
                  </div>
                )}
                <div className="text-[10px] font-mono text-accent-2/40 uppercase tracking-widest">
                  ID: {project.id}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center rounded-pill border border-line bg-transparent px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted transition-all hover:bg-bg-elevated hover:text-white"
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
