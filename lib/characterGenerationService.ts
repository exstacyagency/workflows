// lib/characterGenerationService.ts
import { cfg } from "@/lib/config";
import prisma from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';
import { env, requireEnv } from './configGuard.ts';

type CharacterSpec = {
  age?: number;
  ethnicity?: string;
  face?: string;
  skin?: string;
  hair?: string;
  eyes?: string;
  build?: string;
  height?: string;
  [key: string]: any;
};

type CharacterResponse = {
  character_male?: CharacterSpec;
  character_female?: CharacterSpec;
  [key: string]: any;
};

function getAnthropicHeaders() {
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
  const apiKey = env('ANTHROPIC_API_KEY')!;
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

/**
 * Extract first JSON object from an LLM string response.
 */
function parseJsonFromLLM(text: string): any {
  // Try fenced JSON first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1] : text;

  const start = raw.indexOf('{');
  if (start === -1) {
    throw new Error('No "{" found in LLM response');
  }

  let braceCount = 0;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') braceCount++;
    if (raw[i] === '}') braceCount--;
    if (braceCount === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new Error('Unclosed JSON object in LLM response');
  }

  const jsonStr = raw.substring(start, end + 1).trim();
  return JSON.parse(jsonStr);
}

/**
 * Build the character generation prompt, mirroring your n8n node.
 */
function buildCharacterPrompt(params: {
  productName: string;
  customerAvatarJson: any;
}): { system: string; prompt: string } {
  const { productName, customerAvatarJson } = params;

  const prompt = `Generate TWO character specs for ${productName} commercial.

CUSTOMER AVATAR:
${JSON.stringify(customerAvatarJson, null, 2)}

REQUIREMENTS:
- Extract primary pain point from avatar
- Both characters show post-transformation (problem solved visually)
- Physical descriptions must be realistic with natural human imperfections
- Skin: MUST BE natural texture, human skin with realistic imperfections - NO airbrushed perfection
- Age/ethnicity: single specific value, no ranges or options

OUTPUT:
{
  "character_male": {
    "age": number,
    "ethnicity": "specific ethnicity",
    "face": "description with minor asymmetry",
    "skin": "realistic skin with visible pores, subtle texture, minor imperfections",
    "hair": "description",
    "eyes": "description",
    "build": "description",
    "height": "exact height"
  },
  "character_female": {
    "age": number,
    "ethnicity": "specific ethnicity",
    "face": "description with minor asymmetry",
    "skin": "realistic skin with visible pores, subtle texture, minor imperfections",
    "hair": "description",
    "eyes": "description",
    "build": "description",
    "height": "exact height"
  }
}

Return ONLY JSON. No markdown fences.`;

  // We can use a simple system message; the role is mostly in user prompt
  const system =
    'You are a casting director and character designer. Return ONLY valid JSON. No markdown, no explanation.';

  return { system, prompt };
}

/**
 * Call Anthropic Claude with system + prompt.
 */
async function callAnthropic(system: string, prompt: string): Promise<string> {
  const model = cfg().raw("ANTHROPIC_MODEL") ?? 'claude-3-sonnet-20240229';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic request failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? data?.content ?? '';
  return content as string;
}

/**
 * Create or update Character rows from the LLM response.
 */
async function saveCharactersFromResponse(args: {
  projectId: string;
  jobId?: string;
  productName: string;
  raw: CharacterResponse;
}) {
  const { projectId, jobId, raw } = args;

  const male = raw.character_male || {};
  const female = raw.character_female || {};

  const createOne = async (gender: string, spec: CharacterSpec) => {
    return prisma.character.create({
      data: {
        projectId,
        jobId,
        name: gender,
        metadata: spec as any,
      },
    });
  };

  const [maleChar, femaleChar] = await Promise.all([
    createOne('male', male),
    createOne('female', female),
  ]);

  return {
    maleId: maleChar.id,
    femaleId: femaleChar.id,
  };
}

/**
 * Main worker: generate characters for a project based on its latest CustomerAvatar.
 */
export async function runCharacterGeneration(args: {
  projectId: string;
  productName: string;
  jobId?: string;
}) {
  const { projectId, productName, jobId } = args;

  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');

  // Load latest customer avatar for this project
  const avatar = await prisma.customerAvatar.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  if (!avatar) {
    throw new Error(
      'No CustomerAvatar found for this project. Run Phase 1B (Customer Analysis) first.',
    );
  }

  const promptInfo = buildCharacterPrompt({
    productName,
    customerAvatarJson: (avatar as any).persona ?? {},
  });

  const responseText = await callAnthropic(
    promptInfo.system,
    promptInfo.prompt,
  );

  const parsed = parseJsonFromLLM(responseText) as CharacterResponse;

  const ids = await saveCharactersFromResponse({
    projectId,
    jobId,
    productName,
    raw: parsed,
  });

  return ids;
}

/**
 * Convenience wrapper: creates a Job, runs generation, updates job status.
 */
export async function startCharacterGenerationJob(params: {
  projectId: string;
  productName: string;
  jobId: string;
}) {
  const { projectId, productName, jobId } = params;
  await updateJobStatus(jobId, JobStatus.RUNNING);
  try {
    const result = await runCharacterGeneration({
      projectId,
      productName,
      jobId,
    });

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `Character generation complete (male=${result.maleId}, female=${result.femaleId})`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err?.message ?? 'Unknown error in character generation',
      },
    });
    throw err;
  }
}
