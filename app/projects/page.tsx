"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CreateProjectButton from "./CreateProjectButton";

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

  async function createProject() {
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alpha Test Project",
          description: "Created from UI",
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }

      // reload projects after creation
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

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
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Projects</h1>
            <p className="text-sm text-slate-300 mt-1">
              Create and manage FrameForge AI productions. Each project flows through the full research → script → storyboard → video pipeline.
            </p>
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-400">
            {error}
          </p>
        )}
        <div className="pt-2">
          <CreateProjectButton />
        </div>
      </section>

      <div className="space-y-4">
        <button
          onClick={createProject}
          disabled={creating}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create Alpha Project"}
        </button>

        {error && (
          <div className="text-sm text-red-500">
            Failed to create project: {error}
          </div>
        )}
      </div>

      {/* New Project form */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-100">
          New Project
        </h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-300">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ClearGlow Acne Serum Launch"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-300">
              Description
            </label>
            <textarea
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 min-h-[64px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description to remind you what this project is about."
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-xs font-medium"
          >
            {creating ? "Creating…" : "Create Project"}
          </button>
        </form>
      </section>

      {/* Projects list */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Existing Projects
          </h2>
          <button
            onClick={loadProjects}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {projects.length === 0 && !loading && (
          <p className="text-xs text-slate-400">
            No projects yet. Create your first project using the form above.
          </p>
        )}
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-50">
                  {project.name}
                </div>
                {project.description && (
                  <div className="text-xs text-slate-400">
                    {project.description}
                  </div>
                )}
                <div className="text-[11px] text-slate-500">
                  ID: <span className="font-mono">{project.id}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-50"
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
