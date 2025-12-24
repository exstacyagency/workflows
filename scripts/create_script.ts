import prisma from '../lib/prisma';

function usage(): never {
  console.error('Usage: npm run dev:create-script -- <projectId> [rawJson]');
  console.error("Example: npm run dev:create-script -- proj_test '{\"seed\":true}'");
  process.exit(1);
}

async function main() {
  const projectId = process.argv[2];
  const rawJsonArg = process.argv[3] ?? '{}';
  if (!projectId) usage();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run create_script in production.');
  }

  let rawJson: any;
  try {
    rawJson = JSON.parse(rawJsonArg);
  } catch {
    throw new Error('rawJson must be valid JSON string');
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const script = await prisma.script.create({
    data: {
      projectId,
      rawJson,
      status: 'seeded',
    },
    select: { id: true, projectId: true, createdAt: true },
  });

  console.log('Created Script:', script);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
