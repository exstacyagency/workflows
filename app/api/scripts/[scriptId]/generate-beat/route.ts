import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export const runtime = "nodejs";

type ExistingScene = {
  beat: string;
  vo: string;
};

type DataQuality = "full" | "partial" | "minimal";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function firstStringInArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const normalized = asString(entry);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function parseExistingScenes(value: unknown): ExistingScene[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((scene, index) => {
    const raw = asObject(scene) ?? {};
    const beat = asString(raw.beat) || `Beat ${index + 1}`;
    const vo = asString(raw.vo) || "";
    return { beat, vo };
  });
}

function normalizeBeatLabel(value: unknown): string {
  return asString(value) || "New Beat";
}

function formatExistingScenes(scenes: ExistingScene[]): string {
  if (scenes.length === 0) return "No surrounding beats available.";
  return scenes
    .map((scene, index) => `${scene.beat || `Beat ${index + 1}`}: ${scene.vo || ""}`)
    .join("\n");
}

function extractTextFromAnthropicResponse(response: any): string {
  const text = Array.isArray(response?.content)
    ? response.content
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block?.text ?? ""))
        .join("\n")
        .trim()
    : "";
  return text;
}

type CustomerLanguageSource = {
  copyReadyPhrases: string[];
  successLooksLikeQuote: string | null;
  buyTriggerQuote: string | null;
  competitorLandmineTopQuote: string | null;
};

function extractCustomerLanguage(personaInput: unknown): CustomerLanguageSource {
  const persona = asObject(personaInput) ?? {};
  const avatar = asObject(persona.avatar) ?? {};
  const competitiveAnalysis =
    asObject(persona.competitive_analysis) ?? asObject(avatar.competitive_analysis);

  const copyReadyPhrases = Array.from(
    new Set([
      ...asStringArray(persona.copy_ready_phrases),
      ...asStringArray(avatar.copy_ready_phrases),
      ...asStringArray(persona.voc_phrases),
      ...asStringArray(avatar.voc_phrases),
    ]),
  );

  const successLooksLike =
    asObject(persona.success_looks_like) ?? asObject(avatar.success_looks_like);
  const successCriteria = asObject(avatar.success_criteria);
  const successLooksLikeQuote =
    asString(successLooksLike?.quote) ||
    asString(successLooksLike?.emotional_payoff) ||
    asString(successLooksLike?.outcome) ||
    firstStringInArray(successCriteria?.supporting_quotes) ||
    null;

  const buyTrigger = asObject(persona.buy_trigger) ?? asObject(avatar.buy_trigger);
  const buyTriggerQuote =
    asString(buyTrigger?.quote) ||
    firstStringInArray(buyTrigger?.supporting_quotes) ||
    asString(buyTrigger?.trigger) ||
    asString(buyTrigger?.situation) ||
    null;

  const competitorLandmines = Array.isArray(persona.competitor_landmines)
    ? persona.competitor_landmines
    : Array.isArray(avatar.competitor_landmines)
      ? avatar.competitor_landmines
      : [];
  const topCompetitorLandmine = asObject(competitorLandmines[0]);

  const competitorWeaknesses = Array.isArray(competitiveAnalysis?.competitor_weaknesses)
    ? competitiveAnalysis.competitor_weaknesses
    : [];
  const topCompetitorWeakness = asObject(competitorWeaknesses[0]);

  const competitorLandmineTopQuote =
    asString(topCompetitorLandmine?.quote) ||
    asString(topCompetitorLandmine?.impact) ||
    asString(topCompetitorLandmine?.what_failed) ||
    firstStringInArray(topCompetitorWeakness?.supporting_quotes) ||
    null;

  return {
    copyReadyPhrases,
    successLooksLikeQuote,
    buyTriggerQuote,
    competitorLandmineTopQuote,
  };
}

function computeDataQuality(flags: {
  hasCustomer: boolean;
  hasPattern: boolean;
  hasProduct: boolean;
}): DataQuality {
  const count = [flags.hasCustomer, flags.hasPattern, flags.hasProduct].filter(Boolean).length;
  if (count === 3) return "full";
  if (count >= 1) return "partial";
  return "minimal";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { scriptId: string } },
) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scriptId = String(params?.scriptId || "").trim();
  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const beatLabel = normalizeBeatLabel((body as Record<string, unknown>).beatLabel);
  const insertionIndex = normalizeInt(
    (body as Record<string, unknown>).insertionIndex,
    0,
    0,
    999,
  );
  const existingScenes = parseExistingScenes((body as Record<string, unknown>).existingScenes);
  if (!existingScenes) {
    return NextResponse.json({ error: "existingScenes array is required" }, { status: 400 });
  }

  const targetDuration = normalizeInt(
    (body as Record<string, unknown>).targetDuration,
    30,
    1,
    180,
  );
  const beatCount = normalizeInt(
    (body as Record<string, unknown>).beatCount,
    5,
    1,
    20,
  );

  const script = await prisma.script.findFirst({
    where: {
      id: scriptId,
      project: {
        userId,
      },
    },
    select: {
      id: true,
      projectId: true,
      jobId: true,
    },
  });
  if (!script) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }

  if (!script.jobId) {
    return NextResponse.json(
      { error: "Script has no linked job; cannot resolve run context" },
      { status: 400 },
    );
  }

  const scriptJob = await prisma.job.findFirst({
    where: {
      id: script.jobId,
      projectId: script.projectId,
    },
    select: {
      id: true,
      runId: true,
    },
  });
  if (!scriptJob) {
    return NextResponse.json({ error: "Linked script job not found" }, { status: 404 });
  }

  const runId = asString(scriptJob.runId);

  let customerSource: CustomerLanguageSource = {
    copyReadyPhrases: [],
    successLooksLikeQuote: null,
    buyTriggerQuote: null,
    competitorLandmineTopQuote: null,
  };

  let psychologicalMechanism: string | null = null;
  let transferFormula: string | null = null;

  let mechanismProcess: string | null = null;
  let specificClaims: string[] = [];
  let keyFeatures: string[] = [];

  if (runId) {
    const latestCustomerAnalysisJob = await prisma.job.findFirst({
      where: {
        projectId: script.projectId,
        runId,
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.COMPLETED,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        resultSummary: true,
        payload: true,
      },
    });

    if (latestCustomerAnalysisJob) {
      const summary = asObject(latestCustomerAnalysisJob.resultSummary);
      const payload = asObject(latestCustomerAnalysisJob.payload);
      const payloadResult = asObject(payload?.result);
      const summaryResult = asObject(summary?.result);
      const summaryPersona = asObject(summary?.persona) ?? asObject(summaryResult?.persona);
      const summaryAvatar = asObject(summary?.avatar) ?? asObject(summaryResult?.avatar);

      const summaryAvatarId = asString(summary?.avatarId);
      const resultAvatarId = asString(payloadResult?.avatarId);
      const avatarId = summaryAvatarId || resultAvatarId;

      let personaFromAvatarRecord: unknown = null;
      if (avatarId) {
        const avatarRecord = await prisma.customerAvatar.findFirst({
          where: {
            id: avatarId,
            projectId: script.projectId,
          },
          select: { persona: true },
        });
        personaFromAvatarRecord = avatarRecord?.persona ?? null;
      }

      const persona =
        personaFromAvatarRecord ||
        summaryPersona ||
        (summaryAvatar ? { avatar: summaryAvatar } : null) ||
        payloadResult?.persona ||
        null;
      customerSource = extractCustomerLanguage(persona);
    }

    const latestPatternResult = await prisma.adPatternResult.findFirst({
      where: {
        projectId: script.projectId,
        job: {
          is: {
            projectId: script.projectId,
            runId,
            type: JobType.PATTERN_ANALYSIS,
            status: JobStatus.COMPLETED,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        rawJson: true,
      },
    });

    if (latestPatternResult) {
      const patternRoot = asObject(latestPatternResult.rawJson);
      const patternContainer = asObject(patternRoot?.patterns) ?? patternRoot;
      const prescriptiveGuidance =
        asObject(patternContainer?.prescriptiveGuidance) ||
        asObject(patternRoot?.prescriptiveGuidance);

      psychologicalMechanism = asString(prescriptiveGuidance?.psychologicalMechanism);
      transferFormula = asString(prescriptiveGuidance?.transferFormula);
    }

    const latestProductCollectionJob = await prisma.job.findFirst({
      where: {
        projectId: script.projectId,
        runId,
        type: JobType.PRODUCT_DATA_COLLECTION,
        status: JobStatus.COMPLETED,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        resultSummary: true,
        payload: true,
      },
    });

    if (latestProductCollectionJob) {
      const payload = asObject(latestProductCollectionJob.payload);
      const payloadResult = asObject(payload?.result);
      const summary = asObject(latestProductCollectionJob.resultSummary);
      const intel = asObject(payloadResult?.intel) ?? payloadResult;
      const productIntelRecord = await prisma.productIntel.findFirst({
        where: {
          projectId: script.projectId,
          jobId: latestProductCollectionJob.id,
        },
        orderBy: { createdAt: "desc" },
        select: {
          keyClaims: true,
          keyFeatures: true,
          usp: true,
          targetAudience: true,
        },
      });

      const mechanismArray = Array.isArray((intel as any)?.mechanism)
        ? ((intel as any).mechanism as unknown[])
        : [];
      const firstMechanism = asObject(mechanismArray[0]);
      const usage = asString((intel as any)?.usage);
      const format = asString((intel as any)?.format);
      const mainBenefit =
        asString((intel as any)?.main_benefit) ||
        asString((intel as any)?.mainBenefit);

      mechanismProcess =
        asString(firstMechanism?.process) ||
        asString(summary?.mechanismProcess) ||
        asString(productIntelRecord?.usp) ||
        asString(productIntelRecord?.targetAudience) ||
        [usage, format, mainBenefit].filter(Boolean).join("; ") ||
        null;

      specificClaims = Array.from(
        new Set(
          asStringArray((intel as any)?.specific_claims).concat(
            asStringArray((intel as any)?.specificClaims),
            asStringArray((intel as any)?.keyClaims),
            asStringArray((intel as any)?.key_claims),
            asStringArray(summary?.specific_claims),
            asStringArray(summary?.specificClaims),
            asStringArray(productIntelRecord?.keyClaims),
          ),
        ),
      );
      keyFeatures = Array.from(
        new Set(
          asStringArray((intel as any)?.key_features).concat(
            asStringArray((intel as any)?.keyFeatures),
            asStringArray(summary?.key_features),
            asStringArray(summary?.keyFeatures),
            asStringArray(productIntelRecord?.keyFeatures),
          ),
        ),
      );
    }
  }

  const hasCustomer =
    customerSource.copyReadyPhrases.length > 0 ||
    Boolean(customerSource.successLooksLikeQuote) ||
    Boolean(customerSource.buyTriggerQuote) ||
    Boolean(customerSource.competitorLandmineTopQuote);
  const hasPattern = Boolean(psychologicalMechanism || transferFormula);
  const hasProduct =
    Boolean(mechanismProcess) || specificClaims.length > 0 || keyFeatures.length > 0;
  const dataQuality = computeDataQuality({ hasCustomer, hasPattern, hasProduct });

  const secondsPerBeat = Math.max(1, Math.round(targetDuration / beatCount));
  const wordCeiling = Math.max(
    8,
    Math.round((secondsPerBeat / 60) * 135 * 0.9),
  );

  const surroundingBeats = formatExistingScenes(existingScenes);
  let prompt = `You are writing one beat for a UGC video script. The new beat is called "${beatLabel}" and sits at position ${insertionIndex} of ${beatCount}. It owns ${secondsPerBeat} seconds and must stay under ${wordCeiling} words. Here are the surrounding beats:
${surroundingBeats}
Write VO that sounds like the same person who wrote the surrounding beats. Return only the VO text, nothing else.`;

  if (hasPattern) {
    prompt += `\n\nThe script has an established psychological contract with the viewer using these mechanisms: ${psychologicalMechanism || "MISSING"} and this formula: ${transferFormula || "MISSING"}. The new beat must honor this contract.`;
  }

  if (hasCustomer) {
    prompt += `\n\nUse language from these customer phrases where natural: ${customerSource.copyReadyPhrases.join(", ")}. The payoff emotional outcome is: ${customerSource.successLooksLikeQuote || "MISSING"}. The trigger situation is: ${customerSource.buyTriggerQuote || "MISSING"}.`;
  }

  if (hasProduct) {
    prompt += `\n\nReference product facts only from these verified sources. Mechanism: ${mechanismProcess || "MISSING"}. Claims: ${specificClaims.join("; ")}. Features: ${keyFeatures.join(", ")}. Never invent statistics. If no numeric claim fits this beat use emotional language instead.`;
  }

  const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    return NextResponse.json(
      { error: "Anthropic is not configured" },
      { status: 500 },
    );
  }

  let voText = "";
  try {
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 30000,
    });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    voText = extractTextFromAnthropicResponse(response);
  } catch (error: any) {
    return NextResponse.json(
      { error: `Anthropic call failed: ${String(error?.message ?? error)}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      vo: voText,
      dataQuality,
      beatLabel,
      insertionIndex,
    },
    { status: 200 },
  );
}
