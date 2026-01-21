import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PipelineStatusDb } from '@/components/PipelineStatusDb';
import { ScriptMediaPreview, type ScriptMedia } from '@/components/ScriptMediaPreview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function statusBadge(status: 'pending' | 'running' | 'failed' | 'completed') {
  const colorMap: Record<typeof status, string> = {
    pending: 'bg-slate-800/80 text-slate-300 border border-slate-700',
    running: 'bg-sky-500/10 text-sky-300 border border-sky-500/50',
    failed: 'bg-red-500/10 text-red-300 border border-red-500/50',
    completed: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/50',
  };
  const labelMap: Record<typeof status, string> = {
    pending: 'Pending',
    running: 'Running',
    failed: 'Needs Attention',
    completed: 'Completed',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${colorMap[status]}`}>{labelMap[status]}</span>;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type Params = { params: { projectId: string } };

export default async function ProjectDashboardPage({ params }: Params) {
  const projectId = params.projectId;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      _count: {
        select: {
          jobs: true,
          researchRows: true,
          customerAvatars: true,
          productIntelligences: true,
        },
      },
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 12,
      },
      researchRows: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
      customerAvatars: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      productIntelligences: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      scripts: {
        orderBy: { createdAt: 'desc' },
        take: 4,
      },
    },
  });

  if (!project) {
    notFound();
  }

  const recentJobs = project.jobs;
  const recentResearch = project.researchRows;
  const latestAvatar = project.customerAvatars[0] ?? null;
  const latestProductIntel = project.productIntelligences[0] ?? null;
  const latestAvatarPersona = (latestAvatar?.persona ?? {}) as any;
  const latestProductInsights = (latestProductIntel?.insights ?? {}) as any;
  const recentScripts: ScriptMedia[] = project.scripts.map(script => ({
    id: script.id,
    status: script.status,
    createdAt: script.createdAt.toISOString(),
    mergedVideoUrl: script.mergedVideoUrl,
    upscaledVideoUrl: script.upscaledVideoUrl,
    wordCount: script.wordCount,
  }));

  const stats = [
    { label: 'Total Jobs', value: project._count.jobs.toString() },
    { label: 'Research Rows', value: project._count.researchRows.toString() },
    { label: 'Customer Avatars', value: project._count.customerAvatars.toString() },
    { label: 'Product Intel Snapshots', value: project._count.productIntelligences.toString() },
  ];

  return (
    <div className="px-6 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-slate-500">Project</p>
          <h1 className="text-2xl font-semibold text-slate-50">{project.name}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {project.description || 'No description provided yet.'}
          </p>
          <div className="text-[11px] text-slate-500 mt-3">
            ID: <span className="font-mono">{project.id}</span> · Updated{' '}
            {dateFormatter.format(project.updatedAt)}
          </div>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex flex-col gap-2 md:flex-row md:justify-end">
            <Link
              href={`/projects/${project.id}/research`}
              className="inline-flex items-center justify-center rounded-md bg-sky-500 hover:bg-sky-400 px-4 py-2 text-sm font-medium text-white"
            >
              Start Customer Research
            </Link>
            <Link
              href={`/projects/${project.id}/dead-letter`}
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            >
              Dead Letter
            </Link>
          </div>
          <p className="text-xs text-slate-400 max-w-xs text-center md:text-right">
            Phase 1A runs Reddit + review scrapers and stores results for downstream phases.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="text-2xl font-semibold text-slate-50 mt-1">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Customer Avatar</h2>
            <Link href="/customer-profile" className="text-[11px] text-sky-400 hover:text-sky-300">
              Open Profile Studio →
            </Link>
          </div>
          {!latestAvatar ? (
            <p className="text-xs text-slate-400">Run Phase 1B to generate a persona snapshot.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p>
                <span className="text-slate-400">Age</span>: {latestAvatarPersona.age ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Gender</span>: {latestAvatarPersona.gender ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Job</span>: {latestAvatarPersona.jobTitle ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Location</span>: {latestAvatarPersona.location ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Primary Pain</span>: {latestAvatarPersona.primaryPain ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Primary Goal</span>: {latestAvatarPersona.primaryGoal ?? '—'}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Product Intelligence</h2>
            <Link href="/customer-profile" className="text-[11px] text-sky-400 hover:text-sky-300">
              View Details →
            </Link>
          </div>
          {!latestProductIntel ? (
            <p className="text-xs text-slate-400">Run Phase 1B to capture mechanism + timeline insights.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p>
                <span className="text-slate-400">Hero Ingredient</span>: {latestProductInsights.heroIngredient ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Mechanism</span>: {latestProductInsights.heroMechanism ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Form</span>: {latestProductInsights.form ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Initial Timeline</span>: {latestProductInsights.initialTimeline ?? '—'}
              </p>
              <p>
                <span className="text-slate-400">Peak Timeline</span>: {latestProductInsights.peakTimeline ?? '—'}
              </p>
            </div>
          )}
        </div>
      </section>

      <PipelineStatusDb projectId={projectId} />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Recent Jobs</h2>
            <span className="text-[11px] text-slate-500">Latest 12 runs</span>
          </div>
          {recentJobs.length === 0 ? (
            <p className="text-xs text-slate-400">Jobs will appear once workflows begin.</p>
          ) : (
            <div className="space-y-2">
              {recentJobs.map(job => (
                <div key={job.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-50">{job.type.replace(/_/g, ' ')}</p>
                    {statusBadge(
                      job.status === JobStatus.RUNNING
                        ? 'running'
                        : job.status === JobStatus.FAILED
                          ? 'failed'
                          : job.status === JobStatus.COMPLETED
                            ? 'completed'
                            : 'pending'
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Started {dateFormatter.format(job.createdAt)} · Updated {dateFormatter.format(job.updatedAt)}
                  </p>
                  {job.resultSummary && (
                    <p className="text-xs text-slate-300 mt-1">
                      {typeof job.resultSummary === "string"
                        ? job.resultSummary
                        : JSON.stringify(job.resultSummary)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Latest Customer Insights</h2>
            <p className="text-xs text-slate-400">
              Pulled from recent research rows and Phase 1B outputs.
            </p>
          </div>

          <div className="space-y-2">
            {recentResearch.length === 0 ? (
              <p className="text-xs text-slate-400">Run customer research to populate insights.</p>
            ) : (
              recentResearch.map(row => (
                <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>{row.source}</span>
                    <span>{dateFormatter.format(row.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-50 line-clamp-3">{row.content}</p>
                </div>
              ))
            )}
          </div>

        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Scripts & Media</h2>
            <p className="text-xs text-slate-400">
              Preview the most recent scripts and their rendered videos.
            </p>
          </div>
          <Link
            href={`/projects/${project.id}/scripts`}
            className="text-[11px] text-sky-400 hover:text-sky-300"
          >
            View all scripts →
          </Link>
        </div>
        {recentScripts.length === 0 ? (
          <p className="text-xs text-slate-400">
            Run script generation to create your first storyboard-ready video.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {recentScripts.map(script => (
              <div
                key={script.id}
                className="rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3"
              >
                <ScriptMediaPreview script={script} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
