import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

type Params = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Params) {
  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: {
      researchRows: true,
      adAssets: true,
      project: true
    }
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(job);
}
