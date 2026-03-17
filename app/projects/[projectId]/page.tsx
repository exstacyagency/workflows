import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getJobTypeLabel } from '@/lib/jobLabels';
import { ProjectProductsPanel } from '@/components/ProjectProductsPanel';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function statusBadge(status: 'pending' | 'running' | 'failed' | 'completed') {
  const colorMap: Record<typeof status, string> = {
    pending: 'status-chip info opacity-60',
    running: 'status-chip info',
    failed: 'status-chip danger',
    completed: 'status-chip success',
  };
  const labelMap: Record<typeof status, string> = {
    pending: 'Pending',
    running: 'Running',
    failed: 'Needs Attention',
    completed: 'Completed',
  };
  return <span className={colorMap[status]}>{labelMap[status]}</span>;
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

  const stats = [
    { label: 'Total Jobs', value: project._count.jobs.toString() },
    { label: 'Research Rows', value: project._count.researchRows.toString() },
    { label: 'Customer Avatars', value: project._count.customerAvatars.toString() },
    { label: 'Product Intel Snapshots', value: project._count.productIntelligences.toString() },
  ];

  return (
    <div className="app-shell space-y-6">
      <section className="app-surface app-header">
        <div>
          <span className="app-kicker">Project Overview</span>
          <h1 className="app-heading">{project.name}</h1>
          <p className="app-subheading">
            {project.description || 'No description provided yet.'}
          </p>
          <div className="app-status-line mt-4">
            ID: <span className="mono-text">{project.id}</span> · Updated{' '}
            {dateFormatter.format(project.updatedAt)}
          </div>
        </div>
      </section>

      <section className="app-grid app-grid--stats">
        {stats.map(stat => (
          <div key={stat.label} className="app-stat">
            <p className="app-stat-label">{stat.label}</p>
            <p className="app-stat-value">{stat.value}</p>
          </div>
        ))}
      </section>

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

      <section className="app-grid app-grid--two">
        <div className="app-surface space-y-3">
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
                  <p className="text-[10px] text-muted font-mono uppercase opacity-60">
                    Started {dateFormatter.format(job.createdAt)} · Updated {dateFormatter.format(job.updatedAt)}
                  </p>
                  {job.resultSummary && (
                    <p className="text-xs text-muted mt-2 font-mono bg-black/20 p-2 rounded-card border border-line/30">
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
      </section>
    </div>
  );
}
