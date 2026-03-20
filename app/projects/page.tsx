"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CreateProjectButton from "@/app/(app)/projects/CreateProjectButton";
import GlobalNavMenu from "@/components/GlobalNavMenu";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";

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
    <>
      <GlobalNavMenu />
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <a
          href="/studio"
          className="text-label font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
        >
          ← Back to Studio
        </a>
        <PageHeader
          title="Projects"
          actions={<CreateProjectButton />}
        />
        {error && (
          <p className="text-xs text-danger font-mono">{error}</p>
        )}

      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <p className="eyebrow">New Project</p>
            <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
              Start a new workflow from research through video production.
            </p>
          </div>
        </div>
        <SectionCard className="space-y-4" padding="sm">
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
                className="w-full rounded-card border border-line bg-bg-elevated px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors min-h-[80px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional short description to remind you what this project is about."
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="btn btn-primary !min-h-[36px] px-6 text-xs font-bold shadow-panel"
            >
              {creating ? "Creating…" : "Create Project"}
            </button>
          </form>
        </SectionCard>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <p className="eyebrow">Existing Projects</p>
            <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
              Open and manage the projects already in motion.
            </p>
          </div>
          <button
            onClick={loadProjects}
            disabled={loading}
            className="btn btn-secondary !min-h-[32px] px-4 text-label"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <SectionCard className="space-y-4" padding="sm">
          {projects.length === 0 && !loading && (
            <EmptyState
              title="No Projects Yet"
              description="Create your first project using the form above."
            />
          )}
          <div className="space-y-2">
            {projects.map((project) => (
              <SectionCard
                key={project.id}
                padding="none"
                className="flex cursor-pointer items-center justify-between px-5 py-4"
              >
                <div className="space-y-1.5">
                  <div className="text-sm font-bold text-white tracking-tight">
                    {project.name}
                  </div>
                  {project.description && (
                    <div className="text-xs text-muted italic">
                      {project.description}
                    </div>
                  )}
                  <div className="text-label font-mono text-accent-2/40 uppercase tracking-widest">
                    ID: {project.id}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/projects/${project.id}`}
                    className="btn btn-secondary !min-h-[32px] px-4 text-label"
                  >
                    Open
                  </Link>
                </div>
              </SectionCard>
            ))}
          </div>
        </SectionCard>
      </div>
      </div>
    </>
  );
}
