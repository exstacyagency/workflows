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

  const lastProject = projects[0] || null;
  const projectCount = projects.length;

  return (
    <>
      <StudioHeader />
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Victora Studio"
          description="Manage projects, monitor jobs, and keep production moving."
        />
        <WhoAmI />

      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <p className="eyebrow">Project Launcher</p>
            <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
              Jump into your latest work or manage the full project list in one place.
            </p>
          </div>
        </div>
        <SectionCard className="space-y-4" padding="sm">
          {error && <p className="text-xs text-accent">{error}</p>}
          {!loading && projectCount === 0 ? (
            <EmptyState
              title="No Projects Yet"
              description="Create your first project from the dedicated Projects page."
              action={
                <Link
                  href="/projects"
                  className="btn btn-primary !min-h-[32px] px-4 text-label"
                >
                  Go To Projects
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
                  {loading ? "Refreshing project index..." : `${projectCount} project${projectCount === 1 ? "" : "s"} available`}
                </p>
                {lastProject && (
                  <p className="text-body-sm text-muted">
                    Currently active: <span className="text-white">{lastProject.name}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lastProject && (
                  <Link
                    href={`/projects/${lastProject.id}`}
                    className="btn btn-secondary !min-h-[32px] px-4 text-label"
                  >
                    Open Latest Project
                  </Link>
                )}
                <Link
                  href="/projects"
                  className="btn btn-primary !min-h-[32px] px-4 text-label"
                >
                  Go To Projects
                </Link>
                <button
                  onClick={loadProjects}
                  disabled={loading}
                  className="btn btn-secondary !min-h-[32px] px-4 text-label disabled:opacity-50"
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
    </>
  );
}
