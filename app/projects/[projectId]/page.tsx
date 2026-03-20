import { prisma } from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { ProjectProductsPanel } from '@/components/ProjectProductsPanel';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import GlobalNavMenu from "@/components/GlobalNavMenu";
import { PageHeader, SectionCard, SectionLinkCard } from '@/components/ui';
import { getJobTypeLabel } from '@/lib/jobLabels';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    <>
      <GlobalNavMenu projectId={projectId} />
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-10">
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

      <SectionLinkCard
        eyebrow="Research Hub"
        description="Explore customer research, ad analysis, and product intelligence for this project."
        status="Open the research workspace to run collection, analysis, and review completed outputs."
        sectionShell
        action={
          <a
            href={
              primaryProductId
                ? `/projects/${projectId}/research-hub?productId=${primaryProductId}`
                : `/projects/${projectId}/research-hub`
            }
            className="btn btn-primary !min-h-[36px] px-6 shrink-0"
          >
            Open Research Hub
          </a>
        }
      />

      <SectionLinkCard
        eyebrow="Creative Studio"
        description="Turn approved research into scripts, storyboards, prompts, and videos."
        status="Jump into the production pipeline to create and manage creative assets for this project."
        sectionShell
        action={
          <a
            href={
              primaryProductId
                ? `/projects/${projectId}/creative-studio?productId=${primaryProductId}`
                : `/projects/${projectId}/creative-studio`
            }
            className="btn btn-primary !min-h-[36px] px-6 shrink-0"
          >
            Open Creative Studio
          </a>
        }
      />

      <SectionLinkCard
        eyebrow="Usage And Cost"
        description="Review spend, settled provider usage, and project-level execution costs."
        status="Monitor billing activity and cost breakdowns across every job run for this project."
        sectionShell
        action={
          <a
            href={`/projects/${projectId}/usage`}
            className="btn btn-primary !min-h-[36px] px-6 shrink-0"
          >
            Open Usage & Costs
          </a>
        }
      />

      <div className="mt-8">
        <p className="eyebrow mb-4">Recent Jobs</p>
        {recentJobs.length === 0 ? (
          <p className="text-xs text-muted italic">Jobs will appear once workflows begin.</p>
        ) : (
          <div className="app-list">
            {recentJobs.map(job => (
              <div key={job.id} className="app-list-item flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">{getJobTypeLabel(job.type)}</div>
                  <div className="text-xs text-muted">{new Date(job.createdAt).toLocaleString()}</div>
                </div>
                <div className={`app-chip ${
                  job.status === 'COMPLETED' ? 'app-chip--success' :
                  job.status === 'FAILED' ? 'app-chip--danger' :
                  job.status === 'RUNNING' ? 'app-chip--info' :
                  ''
                }`}>
                  {job.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  );
}
