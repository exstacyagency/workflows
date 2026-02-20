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
type ProductListItem = {
  id: string;
  name: string;
  productProblemSolved: string | null;
  amazonAsin: string | null;
  createdAt: Date;
};

type ProjectReferenceImages = {
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
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
}

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
    },
  });

  if (!project) {
    notFound();
  }

  const referenceRows = await prisma.$queryRaw<ProjectReferenceImages[]>`
    SELECT
      "creatorReferenceImageUrl" AS "creatorReferenceImageUrl",
      "productReferenceImageUrl" AS "productReferenceImageUrl"
    FROM "project"
    WHERE "id" = ${projectId}
    LIMIT 1
  `;
  const referenceImages = referenceRows[0] ?? {
    creatorReferenceImageUrl: null,
    productReferenceImageUrl: null,
  };

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
    <div className="px-6 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
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
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="text-2xl font-semibold text-slate-50 mt-1">{stat.value}</p>
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
        initialCreatorReferenceImageUrl={referenceImages.creatorReferenceImageUrl}
        initialProductReferenceImageUrl={referenceImages.productReferenceImageUrl}
      />

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
                    <p className="text-sm font-medium text-slate-50">{getJobTypeLabel(job.type)}</p>
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
      </section>
    </div>
  );
}
