import { prisma } from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function runPatternAnalysis(args: { projectId: string; jobId: string }) {
  const { projectId, jobId } = args;

  let job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Pattern analysis job not found: ${jobId}`);
  }

  job = await prisma.job.update({
    where: { id: job.id },
    data: { status: JobStatus.RUNNING },
  });

  try {
    const assets = await prisma.adAsset.findMany({
      where: { projectId, transcript: { not: null } },
      take: 50,
    });

    if (assets.length === 0) {
      throw new Error('No transcribed ads found');
    }

    const prompt = buildPatternPrompt(assets);

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = JSON.parse(rawText);

    await prisma.$transaction(async (tx) => {
      const result = await tx.adPatternResult.create({
        data: {
          projectId,
          jobId,
          rawJson: parsed,
          baselineRetention3s: parsed.baseline?.retention_3s,
          baselineCtr: parsed.baseline?.ctr,
          totalConverters: parsed.patterns?.length || 0,
        },
      });

      if (parsed.patterns?.length > 0) {
        await tx.adPatternReference.createMany({
          data: parsed.patterns.map((p: any) => ({
            projectId,
            resultId: result.id,
            patternName: p.pattern_name,
            category: p.category,
            timing: p.timing,
            description: p.description,
            example: p.example,
            exampleTimestamp: p.example_timestamp,
            visualNotes: p.visual_notes,
            occurrenceRate: p.occurrence_rate,
            sampleCount: p.sample_count,
            performanceLift: p.performance_lift,
            productionComplexity: p.production_complexity,
            standaloneViable: p.standalone_viable,
            canCoexist: p.can_coexist,
          })),
        });
      }
    });

    job = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Pattern analysis: ${parsed.patterns?.length || 0} patterns`,
      },
    });

    return parsed;
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.FAILED, error: err.message },
    });
    throw err;
  }
}

function buildPatternPrompt(assets: any[]): string {
  const adData = assets.map((a, i) => ({
    id: i + 1,
    transcript: a.transcript?.substring(0, 500),
    retention_3s: (a.metrics as any)?.retention_3s,
    duration: (a.metrics as any)?.duration,
  }));

  return `Analyze these TikTok ads and extract conversion patterns:

${JSON.stringify(adData, null, 2)}

Return JSON:
{
  "baseline": {"retention_3s": 0.15, "ctr": 0.02},
  "patterns": [
    {
      "pattern_name": "Hook technique name",
      "category": "hook|body|cta",
      "timing": "0-3s|3-10s|10s+",
      "description": "What happens",
      "example": "Exact quote",
      "example_timestamp": 2,
      "visual_notes": "Camera work",
      "occurrence_rate": 0.4,
      "sample_count": 12,
      "performance_lift": "Medium|High",
      "production_complexity": "Low|Medium|High",
      "standalone_viable": true,
      "can_coexist": true
    }
  ]
}`;
}

export async function startPatternAnalysisJob(params: { projectId: string }) {
  const { projectId } = params;

  let job = await prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.PATTERN_ANALYSIS,
    },
  });

  if (!job) {
    job = await prisma.job.create({
      data: {
        type: JobType.PATTERN_ANALYSIS,
        status: JobStatus.PENDING,
        projectId,
        payload: { projectId },
      },
    });
  } else {
    job = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.PENDING,
        error: null,
      },
    });
  }

  const { addJob, QueueName } = await import('@/lib/queue');
  await addJob(QueueName.PATTERN_ANALYSIS, job.id, { jobId: job.id, projectId });

  return { jobId: job.id };
}
