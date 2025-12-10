// lib/adPatternAnalysisService.ts
import prisma from '@/lib/prisma';
import { JobType, JobStatus, AdPlatform } from '@prisma/client';

export type AdRecord = {
  id: string;
  projectId: string;
  videoUrl: string;
  transcript: string | null;
  hookText: string | null;
  retention3s: number | null;
  retention10s: number | null;
  duration: number | null;
  ctr: number | null;
  cost: number | null;
  like: number | null;
  adTitle: string | null;
  conversionSpikes: any;
  convertCnt: any;
};

type Spike = {
  second: number;
  value: number;
};

type PatternResult = {
  patterns: any[];
  anti_patterns: any[];
  stacking_rules: any[];
  baseline_retention_3s?: number;
  baseline_ctr?: number;
  total_converters?: number;
  [key: string]: any;
};

type SplitAds = {
  converters: (AdRecord & { spikes: Spike[] })[];
  nonConverters: (AdRecord & { spikes: Spike[] })[];
};

/**
 * Normalize conversion_spikes / convert_cnt into an array of { second, value }.
 */
function normalizeSpikes(raw: any): Spike[] {
  if (!raw) return [];
  try {
    let parsed = raw;
    while (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }

    // Already array of { second, value }
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].second !== undefined) {
      return parsed;
    }

    // Array of seconds
    if (Array.isArray(parsed)) {
      return parsed.map((s: any) => ({
        second: typeof s === 'number' ? s : Number(s),
        value: 1,
      }));
    }

    return [];
  } catch {
    return [];
  }
}

function splitConverters(ads: AdRecord[]): SplitAds {
  const converters: (AdRecord & { spikes: Spike[] })[] = [];
  const nonConverters: (AdRecord & { spikes: Spike[] })[] = [];

  for (const ad of ads) {
    const spikes = normalizeSpikes(ad.conversionSpikes ?? ad.convertCnt);
    if (spikes.length > 0) {
      converters.push({ ...ad, spikes });
    } else {
      nonConverters.push({ ...ad, spikes: [] });
    }
  }

  return { converters, nonConverters };
}

function averageRetention3s(ads: AdRecord[]): number {
  const vals = ads
    .map(a => a.retention3s)
    .filter((v): v is number => typeof v === 'number' && !isNaN(v));

  if (!vals.length) return 0;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

/**
 * System message – same intent as your workflow's "system" string.
 * If you want, you can paste the exact text from JSON here.
 */
function buildSystemPrompt(): string {
  return `Extract tactical ad execution patterns from performance data. Output ONLY valid JSON.

Structure:
{
  "patterns": [...],
  "anti_patterns": [...],
  "stacking_rules": [...]
}

Pattern fields:
- pattern_name: string
- category: "Hook Structure" | "Proof Mechanism" | "Narrative Arc" | "Conversion Trigger"
- description: mechanics explanation + WHY it works psychologically
- example: exact quoted text from converter ads
- example_timestamp: integer (second mark where example occurs)
- occurrence_rate: decimal (pattern_count / total_converters, e.g. 0.47)
- sample_count: integer (number of ads containing this pattern)
- timing: string (spike second range or position like "0-3s", "mid-roll 15-30s")
- visual_notes: string (shot size, camera angle, lighting direction, subject action, product visibility, framing - film production level detail)
- performance_lift: string (format: "metric: +X.XX (pattern_avg vs baseline_avg, n=sample_count)")

Anti-pattern fields:
- pattern_name: string
- why_it_fails: string (mechanism of failure)
- converter_rate: decimal (% of converters exhibiting this)
- non_converter_rate: decimal (% of non-converters exhibiting this)
- rate_delta: decimal (non_converter_rate - converter_rate, shows anti-pattern strength)
- example: exact quoted text from non-converter ads

Stacking rule fields:
- combination: array of 2 pattern_names
- synergy_type: "amplify" | "conflict" | "sequence"
- performance_delta: string (format: "+X.XX metric - explanation of compound effect vs individual pattern lifts")
- baseline_comparison: string (explain if combo is additive, multiplicative, or has interaction penalty)

NO markdown formatting. NO code blocks. ONLY raw JSON object.`;
}

/**
 * User prompt – dataset summary + converter/non-converter ads + requirements.
 * This simplifies your workflow's Generate Prompt node but keeps the intent.
 */
function buildUserPrompt(converters: (AdRecord & { spikes: Spike[] })[], nonConverters: (AdRecord & { spikes: Spike[] })[]): string {
  const convAvgRet = averageRetention3s(converters);
  const nonConvAvgRet = averageRetention3s(nonConverters);
  const baselineDelta = convAvgRet - nonConvAvgRet;
  const totalAds = converters.length + nonConverters.length || 1;

  const convJson = JSON.stringify(
    converters.map(a => ({
      ad_id: a.id,
      hook: a.hookText,
      transcript: a.transcript,
      duration: a.duration ?? 30,
      retention_3s: a.retention3s ?? 0,
      ctr: a.ctr ?? 0,
      spikes: a.spikes,
      spike_count: a.spikes.length,
    })),
    null,
    2,
  );

  const nonConvJson = JSON.stringify(
    nonConverters.slice(0, 25).map(a => ({
      ad_id: a.id,
      hook: a.hookText,
      transcript: a.transcript,
      duration: a.duration ?? 30,
      retention_3s: a.retention3s ?? 0,
      ctr: a.ctr ?? 0,
      spikes: a.spikes,
      spike_count: a.spikes.length,
    })),
    null,
    2,
  );

  return `# DATASET SUMMARY
Total ads: ${totalAds}
Converters: ${converters.length} (${((converters.length / totalAds) * 100).toFixed(1)}%)
Non-converters: ${nonConverters.length}

Converter avg retention_3s: ${convAvgRet.toFixed(3)}
Non-converter avg retention_3s: ${nonConvAvgRet.toFixed(3)}
Baseline retention delta: ${baselineDelta.toFixed(3)}

# CONVERTER ADS (n=${converters.length})
${convJson}

# NON-CONVERTER SAMPLE (n=${Math.min(25, nonConverters.length)})
${nonConvJson}

---
# EXTRACTION REQUIREMENTS

[Use the same bullet rules from the original prompt: pattern counts by category, calculation rules, constraints, anti-pattern rules, stacking rules, baseline metrics, etc.]

Output complete JSON object. No preamble. No markdown. Start with {`;
}

/**
 * Call Anthropic Claude.
 */
async function callAnthropic(system: string, user: string): Promise<PatternResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-sonnet-20240229';

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic request failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? data?.content ?? '';

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('LLM response does not contain a JSON object');
  }

  const jsonStr = content.slice(start, end + 1);
  return JSON.parse(jsonStr) as PatternResult;
}

/**
 * Save the pattern brain + pattern rows to Prisma.
 */
async function savePatternResult(
  projectId: string,
  jobId: string | null,
  result: PatternResult,
) {
  const created = await prisma.adPatternResult.create({
    data: {
      projectId,
      jobId: jobId ?? undefined,
      rawJson: result as any,
      baselineRetention3s: result.baseline_retention_3s ?? null,
      baselineCtr: result.baseline_ctr ?? null,
      totalConverters: result.total_converters ?? null,
    },
  });

  const patterns = Array.isArray(result.patterns) ? result.patterns : [];

  const patternRefs = patterns.map((p: any) => ({
    projectId,
    resultId: created.id,
    patternName: String(p.pattern_name ?? ''),
    category: String(p.category ?? ''),
    timing: String(p.timing ?? ''),
    description: String(p.description ?? ''),
    example: String(p.example ?? ''),
    exampleTimestamp:
      p.example_timestamp != null ? Number(p.example_timestamp) : null,
    visualNotes: String(p.visual_notes ?? ''),
    occurrenceRate:
      p.occurrence_rate != null ? Number(p.occurrence_rate) : null,
    sampleCount: p.sample_count != null ? Number(p.sample_count) : null,
    performanceLift: String(p.performance_lift ?? ''),
    productionComplexity: p.production_complexity
      ? String(p.production_complexity)
      : null,
    standaloneViable:
      typeof p.standalone_viable === 'boolean' ? p.standalone_viable : null,
    canCoexist:
      typeof p.can_coexist === 'boolean' ? p.can_coexist : null,
  }));

  if (patternRefs.length) {
    await prisma.adPatternReference.createMany({ data: patternRefs });
  }

  return created;
}

/**
 * Load ads for this project.
 * ASSUMPTION: You will store Phase 2A metrics into AdAsset.metrics as a JSON like:
 * {
 *   retention_3s: number,
 *   retention_10s: number,
 *   duration: number,
 *   ctr: number,
 *   cost: number,
 *   like: number,
 *   ad_title: string,
 *   hook_text: string,
 *   conversion_spikes: any,
 *   convert_cnt: any
 * }
 *
 * If your metrics JSON is different, adjust mappings below to match.
 */
async function loadAdsForProject(projectId: string): Promise<AdRecord[]> {
  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
    },
  });

  return assets.map(asset => {
    const m: any = asset.metrics || {};
    return {
      id: asset.id,
      projectId: asset.projectId,
      videoUrl: asset.url,
      transcript: asset.transcript ?? null,
      hookText: m.hook_text ?? null,
      retention3s: m.retention_3s != null ? Number(m.retention_3s) : null,
      retention10s: m.retention_10s != null ? Number(m.retention_10s) : null,
      duration: m.duration != null ? Number(m.duration) : null,
      ctr: m.ctr != null ? Number(m.ctr) : null,
      cost: m.cost != null ? Number(m.cost) : null,
      like: m.like != null ? Number(m.like) : null,
      adTitle: m.ad_title ?? null,
      conversionSpikes: m.conversion_spikes ?? null,
      convertCnt: m.convert_cnt ?? null,
    };
  });
}

/**
 * Orchestrator for the Pattern Brain.
 */
export async function runPatternAnalysis(projectId: string, jobId?: string) {
  const ads = await loadAdsForProject(projectId);

  const usable = ads.filter(
    a =>
      a.transcript &&
      a.transcript.trim().length > 0 &&
      a.hookText &&
      a.hookText.trim().length > 0,
  );

  if (!usable.length) {
    throw new Error(
      'No ads with transcript + hook_text available for pattern analysis.',
    );
  }

  const { converters, nonConverters } = splitConverters(usable);

  if (!converters.length) {
    throw new Error(
      'No converter ads (with conversion spikes) available for pattern analysis.',
    );
  }

  const system = buildSystemPrompt();
  const user = buildUserPrompt(converters, nonConverters);

  const patternResult = await callAnthropic(system, user);

  const saved = await savePatternResult(projectId, jobId ?? null, patternResult);
  return saved;
}
