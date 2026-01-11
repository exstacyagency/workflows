import { prisma } from '@/lib/prisma';
import { JobType } from '@prisma/client';

type NormalizedAd = {
  source: 'apify';
  adId: string | null;
  platform: string | null;
  pageName: string | null;
  brand: string | null;
  createdAt: string | null;
  text: string | null;
  mediaUrl: string | null;
  landingUrl: string | null;
  metrics: Record<string, any> | null;
  raw: Record<string, any>;
};

type CountedPattern = {
  value: string;
  count: number;
  examples: string[];
};

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return {};
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    const s = asString(v);
    if (s) return s;
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstSentence(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const idx = cleaned.search(/[.!?]\s/);
  const first = idx >= 0 ? cleaned.slice(0, idx + 1) : cleaned;
  return first.length > 140 ? `${first.slice(0, 137)}...` : first;
}

function clipExample(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function getHeadlineCandidate(ad: NormalizedAd) {
  return firstString(ad.raw?.headline, ad.raw?.title, ad.raw?.ad_title, ad.raw?.adTitle);
}

function getHookCandidate(ad: NormalizedAd): string | null {
  const headline = getHeadlineCandidate(ad);
  if (headline) return headline;
  const primary = asString(ad.text);
  if (!primary) return null;
  const sent = firstSentence(primary);
  return sent ? sent : null;
}

function getCtaCandidate(ad: NormalizedAd): string | null {
  const raw = ad.raw ?? {};
  const direct = firstString(raw?.cta, raw?.callToAction, raw?.call_to_action, raw?.callToActionText, raw?.cta_text);
  if (direct) return direct;

  const text = `${ad.text ?? ''} ${getHeadlineCandidate(ad) ?? ''}`.toLowerCase();
  const candidates = [
    'shop now',
    'learn more',
    'sign up',
    'get started',
    'buy now',
    'order now',
    'download',
    'subscribe',
    'book now',
  ];
  for (const c of candidates) {
    if (text.includes(c)) return c;
  }
  return null;
}

function angleForAd(ad: NormalizedAd): string {
  const t = `${getHeadlineCandidate(ad) ?? ''}\n${ad.text ?? ''}`.toLowerCase();

  const has = (re: RegExp) => re.test(t);
  if (has(/\bbefore\b.*\bafter\b|\btransform(ation|ed)?\b/)) return 'transformation';
  if (has(/\btestimonial\b|\breview\b|\b5\s*star\b|\brated\b/)) return 'testimonial';
  if (has(/\bhow to\b|\btutorial\b|\bstep[- ]by[- ]step\b|\bguide\b/)) return 'how-to';
  if (has(/\bproblem\b|\bstruggle\b|\bfix\b|\bsolution\b/)) return 'problem-solution';
  if (has(/\bpeople are saying\b|\btrusted by\b|\bjoin (thousands|millions)\b|\bsocial proof\b/)) return 'social-proof';
  if (has(/\blimited time\b|\bon sale\b|\bends (today|tonight)\b|\bdeadline\b|\burgent\b/)) return 'urgency';
  if (has(/\baffordable\b|\bcheap\b|\bvalue\b|\bsave\b|\bdeal\b|\bprice\b/)) return 'price-value';
  return 'other';
}

function offerTagsForAd(ad: NormalizedAd): string[] {
  const t = `${getHeadlineCandidate(ad) ?? ''}\n${ad.text ?? ''}`.toLowerCase();
  const tags: string[] = [];

  if (/\b\d{1,3}%\s*(off|discount)\b/.test(t)) tags.push('percent_off');
  if (/\bfree shipping\b/.test(t)) tags.push('free_shipping');
  if (/\blimited time\b|\bends (today|tonight|soon)\b/.test(t)) tags.push('limited_time');
  if (/\b(bogo|buy one get one)\b/.test(t)) tags.push('bogo');
  if (/\bsave\s*\$\s*\d+/.test(t)) tags.push('dollars_off');
  if (/\bfree trial\b|\btrial\b/.test(t)) tags.push('trial');
  if (/\bmoney[- ]back\b|\bguarantee\b/.test(t)) tags.push('guarantee');

  return tags;
}

function bump(map: Map<string, { value: string; count: number; examples: string[] }>, value: string, example: string) {
  const key = normalizeKey(value);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { value, count: 1, examples: example ? [example] : [] });
    return;
  }
  existing.count += 1;
  if (example && existing.examples.length < 3 && !existing.examples.includes(example)) {
    existing.examples.push(example);
  }
}

function topN(map: Map<string, { value: string; count: number; examples: string[] }>, n: number): CountedPattern[] {
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((x) => ({ value: x.value, count: x.count, examples: x.examples }));
}

const OBJECTIONS: Array<{ key: string; label: string; keywords: RegExp[] }> = [
  { key: 'price', label: 'Too expensive', keywords: [/\btoo expensive\b/, /\bpricey\b/, /\bexpensive\b/, /\bcost\b/] },
  { key: 'trust', label: 'Does it work / trust', keywords: [/\bscam\b/, /\btrust\b/, /\bdoesn'?t work\b/, /\blegit\b/] },
  { key: 'complexity', label: 'Hard to use', keywords: [/\bhard to use\b/, /\bconfusing\b/, /\bcomplicated\b/, /\bsetup\b/] },
  { key: 'shipping', label: 'Shipping concerns', keywords: [/\bshipping\b/, /\bdelivered\b/, /\barrival\b/, /\blate\b/] },
  { key: 'support', label: 'Customer support', keywords: [/\bsupport\b/, /\bcustomer service\b/, /\brefund\b/, /\breturn\b/] },
  { key: 'time', label: 'Takes too long', keywords: [/\btoo long\b/, /\btime[- ]consuming\b/, /\bslow\b/] },
];

function countKeywordMentions(text: string, keywords: RegExp[]) {
  let count = 0;
  for (const re of keywords) {
    const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
    if (matches) count += matches.length;
  }
  return count;
}

export async function runPatternAnalysis(args: {
  projectId: string;
  customerResearchJobId: string;
  adPerformanceJobId: string;
}): Promise<{
  ok: true;
  stats: Record<string, any>;
  patterns: {
    topHooks: CountedPattern[];
    topAngles: CountedPattern[];
    ctaPatterns: { topCtas: CountedPattern[] };
    offerPatterns: { offers: CountedPattern[] };
    objectionMap: Array<{
      key: string;
      label: string;
      researchMentions: number;
      adsMentions: number;
      mentionedInAds: boolean;
      exampleResearch: string | null;
      exampleAd: string | null;
    }>;
  };
}> {
  const { projectId, customerResearchJobId, adPerformanceJobId } = args;

  const [crJob, adJob] = await Promise.all([
    prisma.job.findUnique({ where: { id: customerResearchJobId }, select: { id: true, type: true, payload: true } }),
    prisma.job.findUnique({ where: { id: adPerformanceJobId }, select: { id: true, type: true, payload: true } }),
  ]);

  if (!crJob || crJob.type !== JobType.CUSTOMER_RESEARCH) {
    throw new Error(`Invalid customerResearchJobId: ${customerResearchJobId}`);
  }
  if (!adJob || adJob.type !== JobType.AD_PERFORMANCE) {
    throw new Error(`Invalid adPerformanceJobId: ${adPerformanceJobId}`);
  }

  const crPayload = asObject(crJob.payload);
  const adPayload = asObject(adJob.payload);
  const crResult = asObject(crPayload.result);
  const adResult = asObject(adPayload.result);

  const adsUnknown = (adResult.ads ?? adPayload.ads) as unknown;
  let ads: NormalizedAd[] = Array.isArray(adsUnknown) ? (adsUnknown as any[]) : [];

  if (ads.length === 0) {
    const assets = await prisma.adAsset.findMany({
      where: { projectId, jobId: adPerformanceJobId },
      select: { id: true, rawJson: true, platform: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    ads = assets.map((a) => {
      const raw = (a.rawJson as any) || {};
      return ({
        source: 'apify',
        adId: String(a.id),
        platform: String(a.platform ?? '') || null,
        pageName: null,
        brand: null,
        createdAt: a.createdAt ? a.createdAt.toISOString() : null,
        text: asString(raw?.transcript) ?? null,
        mediaUrl: asString(raw?.url) ?? null,
        landingUrl: null,
        metrics: raw?.metrics && typeof raw.metrics === 'object' ? raw.metrics : null,
        raw: {
          id: a.id,
          url: raw?.url,
          platform: a.platform,
          metrics: raw?.metrics,
          transcript: raw?.transcript,
          createdAt: a.createdAt?.toISOString?.() ?? String(a.createdAt ?? ''),
        },
      } as NormalizedAd);
    });
  }

  const hookCounts = new Map<string, { value: string; count: number; examples: string[] }>();
  const ctaCounts = new Map<string, { value: string; count: number; examples: string[] }>();
  const offerCounts = new Map<string, { value: string; count: number; examples: string[] }>();
  const angleCounts = new Map<string, { value: string; count: number; examples: string[] }>();

  for (const ad of ads) {
    const hook = getHookCandidate(ad);
    if (hook) bump(hookCounts, hook, clipExample(hook));

    const cta = getCtaCandidate(ad);
    if (cta) bump(ctaCounts, cta, clipExample(`${getHeadlineCandidate(ad) ?? ad.text ?? ''}`));

    const angle = angleForAd(ad);
    bump(angleCounts, angle, clipExample(getHeadlineCandidate(ad) ?? ad.text ?? ''));

    const offers = offerTagsForAd(ad);
    for (const o of offers) {
      bump(offerCounts, o, clipExample(getHeadlineCandidate(ad) ?? ad.text ?? ''));
    }
  }

  const researchRows = await prisma.researchRow.findMany({
    where: { projectId, jobId: customerResearchJobId },
    select: { content: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const researchText = researchRows.map((r) => r.content ?? '').join('\n').toLowerCase();
  const adText = ads
    .map((a) => `${getHeadlineCandidate(a) ?? ''}\n${a.text ?? ''}`.toLowerCase())
    .join('\n');

  const objectionMap = OBJECTIONS.map((o) => {
    const researchMentions = researchText ? countKeywordMentions(researchText, o.keywords) : 0;
    const adsMentions = adText ? countKeywordMentions(adText, o.keywords) : 0;

    const exampleResearch =
      researchRows.find((r) => o.keywords.some((re) => re.test((r.content ?? '').toLowerCase())))?.content ?? null;
    const exampleAd =
      ads.find((a) => o.keywords.some((re) => re.test(`${getHeadlineCandidate(a) ?? ''}\n${a.text ?? ''}`.toLowerCase())))
        ?.text ?? null;

    return {
      key: o.key,
      label: o.label,
      researchMentions,
      adsMentions,
      mentionedInAds: adsMentions > 0,
      exampleResearch: exampleResearch ? clipExample(exampleResearch) : null,
      exampleAd: exampleAd ? clipExample(exampleAd) : null,
    };
  });

  const stats = {
    projectId,
    customerResearchJobId,
    adPerformanceJobId,
    adsCount: ads.length,
    researchRowCount: researchRows.length,
    customerResearchResultKeys: Object.keys(crResult),
    adPerformanceResultKeys: Object.keys(adResult),
  };

  return {
    ok: true,
    stats,
    patterns: {
      topHooks: topN(hookCounts, 10),
      topAngles: topN(angleCounts, 10),
      ctaPatterns: { topCtas: topN(ctaCounts, 10) },
      offerPatterns: { offers: topN(offerCounts, 10) },
      objectionMap,
    },
  };
}
