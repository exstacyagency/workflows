"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StudioHeader from "./StudioHeader";
import WhoAmI from "./WhoAmI";
import CreateProjectButton from "@/app/(app)/projects/CreateProjectButton";

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

  return (
    <>
      <StudioHeader />
      <div className="px-6 py-6 space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            FrameForge AI · Studio Command Center
          </h1>
          <WhoAmI />
          <p className="text-sm text-slate-300 mt-1">
            Monitor your production pipeline, resume active projects, and launch
            new cinematic workflows.
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          {lastProject ? (
            <>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Resume Project
              </div>
              <div className="text-sm font-medium text-slate-50">
                {lastProject.name}
              </div>
              <Link
                href={`/projects/${lastProject.id}`}
                className="mt-1 inline-flex items-center px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 text-xs font-medium"
              >
                Open Project
              </Link>
            </>
          ) : (
            <div className="text-sm text-slate-400">
              No projects yet. Once you add projects, you’ll be able to resume
              them from here.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">
          Pipeline Milestones
        </h2>
        <p className="text-xs text-slate-400 mb-3">
          This represents the full FrameForge AI workflow from insights to
          final delivery. Detailed status will appear on each project’s
          dashboard.
        </p>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          {[
            "1 · Research",
            "2 · Avatar & Product Intel",
            "3 · Pattern Brain",
            "4 · Script",
            "5 · Storyboards & Frames",
            "6 · Scenes & Review",
            "7 · Upscale & Export",
          ].map((label) => (
            <span
              key={label}
              className="px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700"
            >
              {label}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Projects</h2>
          <CreateProjectButton />
          <button
            onClick={loadProjects}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {projects.length === 0 && !loading && (
          <p className="text-xs text-slate-400">
            No projects found. Use your existing API or a future UI form to
            create projects.
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
    </>
  );
}
