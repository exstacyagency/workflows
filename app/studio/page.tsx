"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StudioHeader from "./StudioHeader";
import WhoAmI from "./WhoAmI";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";

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
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <SectionCard className="space-y-3 rounded-card" padding="sm">
        <PageHeader
          title="Victora Studio"
          description="Manage projects, monitor jobs, and keep production moving."
          actions={
            lastProject ? (
              <div className="flex flex-col items-start md:items-end gap-2">
                <div className="text-body-sm uppercase tracking-wide text-muted">
                  Resume Project
                </div>
                <div className="text-sm font-medium text-white">
                  {lastProject.name}
                </div>
                <Link
                  href={`/projects/${lastProject.id}`}
                  className="mt-1 btn btn-secondary !min-h-[32px] px-4 text-label"
                >
                  Open Project
                </Link>
              </div>
            ) : (
              <EmptyState
                title="No Projects Yet"
                description="Once you add projects, you’ll be able to resume them from here."
              />
            )
          }
        />
        <WhoAmI />
      </SectionCard>

      <SectionCard className="space-y-3 rounded-card" padding="sm">
        <div className="flex items-center justify-between">
          <p className="eyebrow !mb-0">Projects</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartCreateProject}
              disabled={creatingProject}
              className="btn btn-primary !min-h-[32px] px-4 text-label disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingProject ? "Creating…" : "Create Project"}
            </button>
            <button
              onClick={loadProjects}
              disabled={loading}
              className="btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {showCreateForm && (
          <SectionCard className="space-y-3" padding="sm">
            <label
              htmlFor="project-name"
              className="block text-xs font-medium text-white"
            >
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Optional: defaults to timestamp name"
              className="w-full rounded-inner bg-bg border border-line px-3 py-2 text-sm text-white"
              disabled={creatingProject}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirmCreateProject}
                disabled={creatingProject}
                className="btn btn-primary !min-h-[32px] px-4 text-label disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingProject ? "Creating…" : "Confirm"}
              </button>
              <button
                onClick={handleCancelCreateProject}
                disabled={creatingProject}
                className="btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {createError && <p className="text-xs text-accent">{createError}</p>}
          </SectionCard>
        )}
        {error && <p className="text-xs text-accent">{error}</p>}
        {projects.length === 0 && !loading && (
          <EmptyState
            title="No Projects Found"
            description="Use your existing API or a future UI form to create projects."
          />
        )}
        <div className="space-y-2">
          {projects.map((project) => (
            <SectionCard
              key={project.id}
              padding="none"
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-white">
                  {project.name}
                </div>
                {project.description && (
                  <div className="text-xs text-muted">
                    {project.description}
                  </div>
                )}
                <div className="text-body-sm text-muted">
                  ID: <span className="font-mono">{project.id}</span>
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
    </>
  );
}
