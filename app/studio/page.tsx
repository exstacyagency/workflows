"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StudioHeader from "./StudioHeader";
import WhoAmI from "./WhoAmI";

type Project = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export default function StudioHomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (res.status === 401 || res.status === 403) {
        throw new Error("Unauthorized");
      }
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

  async function handleConfirmCreateProject() {
    setCreatingProject(true);
    setCreateError(null);

    try {
      const enteredName = projectName.trim();
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .slice(0, 15);
      const finalName = enteredName || `Project ${timestamp}`;

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name: finalName,
          description: "Created from Studio UI",
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      const project = await res.json();
      window.location.href = `/projects/${project.id}`;
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create project");
      setCreatingProject(false);
    }
  }

  function handleStartCreateProject() {
    setShowCreateForm(true);
    setCreateError(null);
  }

  function handleCancelCreateProject() {
    setShowCreateForm(false);
    setProjectName("");
    setCreateError(null);
  }

  const lastProject = projects[0] || null;

  return (
    <>
      <StudioHeader />
      <div className="px-6 py-6 space-y-8">
      <section className="rounded-xl border border-line bg-panel p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Victora Studio
          </h1>
          <WhoAmI />
          <p className="text-sm text-muted mt-1">
            Manage projects, monitor jobs, and keep production moving.
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          {lastProject ? (
            <>
              <div className="text-[11px] uppercase tracking-wide text-muted/60">
                Resume Project
              </div>
              <div className="text-sm font-medium text-white">
                {lastProject.name}
              </div>
              <Link
                href={`/projects/${lastProject.id}`}
                className="mt-1 inline-flex items-center px-3 py-1.5 rounded-pill bg-accent hover:bg-accent/90 text-bg text-xs font-medium"
              >
                Open Project
              </Link>
            </>
          ) : (
            <div className="text-sm text-muted/80">
              No projects yet. Once you add projects, you’ll be able to resume
              them from here.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Projects</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartCreateProject}
              disabled={creatingProject}
              className="inline-flex items-center px-3 py-1.5 rounded-pill bg-accent hover:bg-accent/90 text-bg disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
            >
              {creatingProject ? "Creating…" : "Create Project"}
            </button>
            <button
              onClick={loadProjects}
              disabled={loading}
              className="text-xs px-3 py-1 rounded-md border border-line hover:bg-bg-elevated disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {showCreateForm && (
          <div className="rounded-lg border border-line bg-panel p-3 space-y-3">
            <label
              htmlFor="project-name"
              className="block text-xs font-medium text-white/90"
            >
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Optional: defaults to timestamp name"
              className="w-full rounded-md bg-bg border border-line px-3 py-2 text-sm text-white"
              disabled={creatingProject}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirmCreateProject}
                disabled={creatingProject}
                className="inline-flex items-center px-3 py-1.5 rounded-pill bg-accent hover:bg-accent/90 text-bg disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
              >
                {creatingProject ? "Creating…" : "Confirm"}
              </button>
              <button
                onClick={handleCancelCreateProject}
                disabled={creatingProject}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-line hover:bg-bg-elevated disabled:opacity-50 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
            {createError && <p className="text-xs text-accent">{createError}</p>}
          </div>
        )}
        {error && <p className="text-xs text-accent">{error}</p>}
        {projects.length === 0 && !loading && (
          <p className="text-xs text-muted/80">
            No projects found. Use your existing API or a future UI form to
            create projects.
          </p>
        )}
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-white">
                  {project.name}
                </div>
                {project.description && (
                  <div className="text-xs text-muted/80">
                    {project.description}
                  </div>
                )}
                <div className="text-[11px] text-muted/60">
                  ID: <span className="font-mono">{project.id}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs px-3 py-1.5 rounded-md bg-bg-elevated hover:bg-panel-strong text-white"
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
    </>
  );
}
