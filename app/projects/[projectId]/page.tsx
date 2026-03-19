import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getJobTypeLabel } from '@/lib/jobLabels';
import { ProjectProductsPanel } from '@/components/ProjectProductsPanel';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import { PageHeader, SectionCard, StatusChip } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function statusBadge(status: 'pending' | 'running' | 'failed' | 'completed') {
  const labelMap: Record<typeof status, string> = {
    pending: 'Pending',
    running: 'Running',
    failed: 'Needs Attention',
    completed: 'Completed',
  };
  const variantMap: Record<typeof status, "info" | "running" | "danger" | "success"> = {
    pending: "info",
    running: "running",
    failed: "danger",
    completed: "success",
  };
  return (
    <StatusChip variant={variantMap[status]} className={status === "pending" ? "opacity-60" : ""}>
      {labelMap[status]}
    </StatusChip>
  );
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type Params = { params: Promise<{ projectId: string }> };
type ProductListItem = {
  id: string;
  name: string;
  productProblemSolved: string | null;
  amazonAsin: string | null;
  createdAt: Date;
};

async function ensureProductsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "product" (
      "id" text PRIMARY KEY,
      "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "product_problem_solved" text,
      "amazon_asin" text,
      "creator_reference_image_url" text,
      "product_reference_image_url" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "product_project_name_unique" UNIQUE ("project_id", "name")
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "product_project_id_idx" ON "product" ("project_id");`
  );
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "creator_reference_image_url" text;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "product"
    ADD COLUMN IF NOT EXISTS "product_reference_image_url" text;
  `);
}

export default async function ProjectDashboardPage({ params }: Params) {
  const { projectId } = await params;
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
    },
  });

  if (!project) {
    notFound();
  }

  await ensureProductsTable();

  const products = await prisma.$queryRaw<ProductListItem[]>`
    SELECT
      "id",
      "name",
      "product_problem_solved" AS "productProblemSolved",
      "amazon_asin" AS "amazonAsin",
      "created_at" AS "createdAt"
    FROM "product"
    WHERE "project_id" = ${projectId}
    ORDER BY "created_at" DESC
  `;

  const recentJobs = project.jobs;

  const primaryProductId = products[0]?.id ?? null;
  const stats = [
    { label: 'Research Rows', value: project._count.researchRows.toString() },
    { label: 'Video Generations', value: project._count.productIntelligences.toString() },
    { label: 'Products', value: products.length.toString() },
    { label: 'Total Jobs', value: project._count.jobs.toString() },
  ];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <div>
        <a
          href="/studio"
          className="text-body-sm font-mono text-muted hover:text-white inline-block uppercase tracking-wider transition-colors"
        >
          ← Back to Studio
        </a>
      </div>

      <SectionCard padding="lg">
        <PageHeader
          eyebrow="Project Overview"
          title={project.name}
          description={project.description || 'No description provided yet.'}
        />
        <p className="text-body-sm font-mono text-muted mt-4">
          ID: {project.id} · Updated {dateFormatter.format(project.updatedAt)}
        </p>
      </SectionCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(stat => (
          <SectionCard key={stat.label} padding="md">
            <p className="eyebrow mb-2">{stat.label}</p>
            <p className="text-3xl font-bold text-white">{stat.value}</p>
          </SectionCard>
        ))}
      </div>

      <ProjectProductsPanel
        projectId={projectId}
        initialProducts={products.map((product) => ({
          id: product.id,
          name: product.name,
          createdAt: product.createdAt.toISOString(),
        }))}
      />

      <ProjectSettingsPanel
        projectId={projectId}
        initialName={project.name}
        initialDescription={project.description}
      />

      <SectionCard className="space-y-3">
        <div className="app-panel-header">
          <div>
            <h2 className="app-section-title text-white">Research Hub</h2>
            <p className="text-sm text-muted mt-1 italic">
              Explore customer research, ad analysis, and product intelligence for this project.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="app-status-line">
            Open the research workspace to run collection, analysis, and review completed outputs.
          </p>
          <a
            href={
              primaryProductId
                ? `/projects/${projectId}/research-hub?productId=${primaryProductId}`
                : `/projects/${projectId}/research-hub`
            }
            className="app-button app-button--primary text-sm font-medium"
          >
            Open Research Hub
          </a>
        </div>
      </SectionCard>

      <SectionCard className="space-y-3">
        <div className="app-panel-header">
          <div>
            <h2 className="app-section-title text-white">Creative Studio</h2>
            <p className="text-sm text-muted mt-1 italic">
              Turn approved research into scripts, storyboards, prompts, and videos.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="app-status-line">
            Jump into the production pipeline to create and manage creative assets for this project.
          </p>
          <a
            href={
              primaryProductId
                ? `/projects/${projectId}/creative-studio?productId=${primaryProductId}`
                : `/projects/${projectId}/creative-studio`
            }
            className="app-button app-button--primary text-sm font-medium"
          >
            Open Creative Studio
          </a>
        </div>
      </SectionCard>

      <SectionCard className="space-y-3">
        <div className="app-panel-header">
          <div>
            <h2 className="app-section-title text-white">Usage and Cost</h2>
            <p className="text-sm text-muted mt-1 italic">
              Review spend, settled provider usage, and project-level execution costs.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="app-status-line">
            Monitor billing activity and cost breakdowns across every job run for this project.
          </p>
          <a
            href={`/projects/${projectId}/usage`}
            className="app-button app-button--primary text-sm font-medium"
          >
            Open Usage & Costs
          </a>
        </div>
      </SectionCard>

      <SectionCard className="space-y-3 overflow-hidden">
        <div className="app-panel-header">
          <h2 className="app-section-title text-white">Recent Jobs</h2>
          <span className="app-status-line">Latest 12 runs</span>
        </div>
        {recentJobs.length === 0 ? (
          <p className="text-xs text-muted italic">Jobs will appear once workflows begin.</p>
        ) : (
          <div className="app-list">
            {recentJobs.map(job => (
              <div key={job.id} className="app-list-item">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white tracking-tight">{getJobTypeLabel(job.type)}</p>
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
                <p className="text-label text-muted font-mono uppercase opacity-60">
                  Started {dateFormatter.format(job.createdAt)} · Updated {dateFormatter.format(job.updatedAt)}
                </p>
                {job.resultSummary && (
                  <p className="text-xs text-muted mt-2 font-mono bg-panel p-2 rounded-card border border-line/30">
                    {typeof job.resultSummary === "string"
                      ? job.resultSummary
                      : JSON.stringify(job.resultSummary)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
