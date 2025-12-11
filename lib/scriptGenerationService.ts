// lib/scriptGenerationService.ts
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import type { Job } from '@prisma/client';

type Pattern = {
  pattern_name: string;
  category: string;
  description?: string;
  example?: string;
  timing?: string;
  visual_notes?: string;
  occurrence_rate?: number | string;
  sample_count?: number;
  production_complexity?: string;
  standalone_viable?: boolean;
  can_coexist?: boolean;
  [key: string]: any;
};

type StackingRule = {
  combination: string[];
  synergy_type: string;
  performance_delta?: string;
  baseline_comparison?: string;
  reason?: string;
  [key: string]: any;
};

type AntiPattern = {
  pattern_name: string;
  why_it_fails?: string;
  converter_rate?: number;
  non_converter_rate?: number;
  rate_delta?: number;
  example?: string;
  [key: string]: any;
};

type ScriptJSON = {
  scenes: any[];
  vo_full?: string;
  word_count?: number;
  blocker_resolution_method?: string;
  pattern_application?: {
    hook_fidelity?: string;
    proof_fidelity?: string;
    synergy_utilized?: string;
  };
  [key: string]: any;
};

function getAnthropicHeaders() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

async function callAnthropic(system: string, prompt: string): Promise<string> {
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-opus-20240229';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic script generation failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? data?.content ?? '';
  return content as string;
}

function parseJsonFromLLM(text: string): ScriptJSON {
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
  return JSON.parse(jsonStr) as ScriptJSON;
}

/**
 * Build script prompt from avatar, product intel, and pattern brain.
 */
function buildScriptPrompt(args: {
  productName: string;
  avatar: any;
  productIntel: any;
  patterns: Pattern[];
  antiPatterns: AntiPattern[];
  stackingRules: StackingRule[];
}): { system: string; prompt: string } {
  const { productName, avatar, productIntel, patterns, antiPatterns, stackingRules } = args;

  const hookCandidates = patterns.filter(
    p => p.category === 'Hook Structure' && String(p.occurrence_rate) === 'high',
  );
  const hookPattern =
    hookCandidates[0] ||
    patterns.find(p => p.category === 'Hook Structure') ||
    patterns[0];

  const proofCandidates = patterns.filter(p => p.category === 'Proof Mechanism');
  const amplifyRule = stackingRules.find(
    r =>
      r.synergy_type === 'amplify' &&
      Array.isArray(r.combination) &&
      hookPattern &&
      r.combination.includes(hookPattern.pattern_name),
  );
  const proofPattern =
    (amplifyRule &&
      proofCandidates.find(p =>
        amplifyRule.combination.includes(p.pattern_name),
      )) ||
    proofCandidates.find(p => String(p.occurrence_rate) === 'high') ||
    proofCandidates[0] ||
    patterns[0];

  const conflictRule = stackingRules.find(
    r =>
      r.synergy_type === 'conflict' &&
      r.combination?.includes(hookPattern?.pattern_name) &&
      r.combination?.includes(proofPattern?.pattern_name),
  );

  if (conflictRule) {
    throw new Error(
      `Pattern conflict: ${hookPattern?.pattern_name} + ${proofPattern?.pattern_name} → ${conflictRule.performance_delta}`,
    );
  }

  const highFailAnti = antiPatterns
    .filter(ap => (ap.non_converter_rate ?? 0) > 0.5)
    .map(ap => `${ap.pattern_name}: ${ap.why_it_fails}`)
    .join('\n');

  const avatarSnap = avatar?.avatar_snapshot ?? {};
  const psycho =
    typeof avatar.psychographics === 'string'
      ? avatar.psychographics
      : JSON.stringify(avatar.psychographics ?? {});

  const goalNow = Array.isArray(avatar.goals?.now) ? avatar.goals.now[0] : null;
  const goalFuture = Array.isArray(avatar.goals?.future)
    ? avatar.goals.future[0]
    : null;
  const goal = goalNow || goalFuture || 'solve the core problem';

  const firstBlocker = Array.isArray(avatar.purchase_blockers)
    ? avatar.purchase_blockers[0]
    : undefined;

  const blockerFear = firstBlocker?.fear || 'wasting money';
  const blockerQuote = firstBlocker?.quote || '';

  const mechanismProcess = productIntel?.mechanism?.[0]?.process || 'addresses root cause';

  const system = 'Generate 32-second commercial script. ONLY valid JSON. No markdown.';

  const prompt = `INPUTS
Product: ${productName}
Mechanism: ${mechanismProcess}
Avatar: ${avatarSnap.age ?? 30}yo ${avatarSnap.gender || 'person'}, ${avatarSnap.job || 'working professional'}
Psycho: ${psycho || 'cares about quality and results'}
Goal: ${goal}
Blocker: ${blockerFear}
Blocker quote: "${blockerQuote}"

PATTERN INTELLIGENCE
Hook: ${hookPattern?.pattern_name || 'Unknown'} (${hookPattern?.occurrence_rate || 'unknown'} occurrence)
Example: "${hookPattern?.example || ''}"
Timing: ${hookPattern?.timing || '0-3s'}
Visual: ${hookPattern?.visual_notes || 'N/A'}

Proof: ${proofPattern?.pattern_name || 'Unknown'} (${proofPattern?.occurrence_rate || 'unknown'} occurrence)
How: ${proofPattern?.description || ''}
Timing: ${proofPattern?.timing || ''}
Visual: ${proofPattern?.visual_notes || ''}

Synergy: ${amplifyRule?.performance_delta || 'neutral'}
WHY synergy works: ${amplifyRule?.baseline_comparison || amplifyRule?.reason || 'patterns reinforce belief and reduce friction'}

EXECUTION RULES
Duration: 32s (4 scenes × 8s)
Scene structure:
- Scene 1 (0-8s): Hook pattern psychology
- Scene 2 (8-16s): Proof pattern intro, product visible 12-16s
- Scene 3 (16-24s): Proof demonstration completes
- Scene 4 (24-32s): Resolution, goal achieved

VO: 48 words max @ 90 WPM
- Scene 1: 0-10 words
- Scene 2: 12-16 words (must break mid-sentence for Scene 3)
- Scene 3: 12-16 words
- Scene 4: 10-14 words

Product entry: visible 12-16s (Scene 2 second half)
Product duration: minimum 8s on-screen (Scenes 2-3)

Format: Cinematic commercial (professional talent, controlled set)
Translation: UGC pattern psychology → elevated execution
NOT: handheld selfie, bathroom mirror, phone-in-hand.

Blocker resolution: Address "${blockerFear}" through proof demonstration, NEVER spoken exposition.

Proof constraint: Proof sequence must be fully visualized within Scenes 2–3. No time-lapse or "weeks later" montage.

BANNED:
- self-examination actions (touching face/body in the mirror)
- heavy motion graphics overlays
- flashy text animations

ANTI-PATTERNS (HIGH FAIL RATE)
${highFailAnti}

OUTPUT SCHEMA
{
  "scenes": [
    {
      "scene": 1,
      "duration": "0-8s",
      "narrative": "what happens narratively",
      "character_action": "specific physical action + expression",
      "environment": "location + aesthetic (modern/warm/clinical)",
      "vo": "text or null",
      "product_visible": false
    },
    {
      "scene": 2,
      "duration": "8-16s",
      "narrative": "proof mechanism begins",
      "character_action": "action with product interaction 12s+",
      "environment": "location + time-of-day if changed",
      "vo": "text breaking mid-sentence",
      "product_visible": true,
      "product_timing": "12-16s",
      "product_context": "how product appears (hand-held/on-counter/in-use)"
    },
    {
      "scene": 3,
      "duration": "16-24s",
      "narrative": "proof completes",
      "character_action": "result demonstration",
      "environment": "location",
      "vo": "sentence completion + result",
      "product_visible": true,
      "continuity": "same_outfit or outfit_change or time_shift_lighting"
    },
    {
      "scene": 4,
      "duration": "24-32s",
      "narrative": "goal achieved",
      "character_action": "final state showing transformation",
      "environment": "location",
      "vo": "resolution text",
      "product_visible": false
    }
  ],
  "vo_full": "complete voiceover with scene markers",
  "word_count": number,
  "blocker_resolution_method": "how proof addresses fear without stating it",
  "pattern_application": {
    "hook_fidelity": "how hook example translated",
    "proof_fidelity": "how proof mechanism executed",
    "synergy_utilized": "how patterns amplified each other"
  }
}

CRITICAL: Scenes must chain. Scene N ending state = Scene N+1 starting state. Character outfit consistent unless continuity marker specifies change.

Return ONLY JSON.`;

  return { system, prompt };
}

/**
 * Main worker: Script generation for a project.
 */
export async function runScriptGeneration(args: { projectId: string; jobId?: string }) {
  const { projectId, jobId } = args;

  // Load dependencies:
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error('Project not found');
  }

  const avatar = await prisma.customerAvatar.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  const productIntel = await prisma.productIntelligence.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  const patternResult = await prisma.adPatternResult.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  const missingDeps: string[] = [];
  if (!avatar) missingDeps.push('avatar');
  if (!productIntel) missingDeps.push('product_intelligence');
  if (!patternResult) missingDeps.push('pattern_result');

  if (missingDeps.length > 0) {
    console.warn(
      'Script generation missing dependencies (dev mode):',
      missingDeps.join(', '),
    );
  }

  const patternData = (patternResult?.rawJson as {
    patterns?: Pattern[];
    anti_patterns?: AntiPattern[];
    stacking_rules?: StackingRule[];
    [key: string]: any;
  }) ?? {};

  const patterns = patternData.patterns || [];
  const antiPatterns = patternData.anti_patterns || [];
  const stackingRules = patternData.stacking_rules || [];

  if (!patterns.length && !missingDeps.includes('pattern_result')) {
    throw new Error('No patterns found in pattern brain for this project.');
  }

  const { system, prompt } = buildScriptPrompt({
    productName: project.name,
    avatar: avatar?.rawJson ?? {},
    productIntel: productIntel?.rawJson ?? {},
    patterns,
    antiPatterns,
    stackingRules,
  });

  const scriptRecord = await prisma.script.create({
    data: {
      projectId,
      jobId,
      mergedVideoUrl: null,
      upscaledVideoUrl: null,
      status: 'PENDING',
      rawJson: {},
      wordCount: 0,
    },
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      'ANTHROPIC_API_KEY not set – dev mode, skipping LLM call for script generation',
    );
    return scriptRecord;
  }

  const responseText = await callAnthropic(system, prompt);
  const scriptJson = parseJsonFromLLM(responseText);

  const updatedScript = await prisma.script.update({
    where: { id: scriptRecord.id },
    data: {
      rawJson: scriptJson as any,
      wordCount:
        typeof scriptJson.word_count === 'number'
          ? scriptJson.word_count
          : null,
      status: 'READY',
    },
  });

  return updatedScript;
}

/**
 * Convenience wrapper to run script generation as a Job.
 */
export async function startScriptGenerationJob(projectId: string, job: Job) {
  try {
    const script = await runScriptGeneration({ projectId, jobId: job.id });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Script generated (scriptId=${script.id}, words=${script.wordCount ?? 'unknown'})`,
      },
    });

    return {
      jobId: job.id,
      scriptId: script.id,
      script,
    };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error during script generation',
      },
    });

    throw err;
  }
}
