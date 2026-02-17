import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { JobStatus, JobType } from "@prisma/client";
import { cfg } from "@/lib/config";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

type SceneInput = {
  beat?: unknown;
  vo?: unknown;
  duration?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : fallback;
}

function normalizeScenes(value: unknown): Array<{ beat: string; vo: string; duration: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((scene, index) => {
    const raw = (scene ?? {}) as SceneInput;
    const beat = asString(raw.beat) || `Beat ${index + 1}`;
    const vo = asString(raw.vo);
    const durationRaw = raw.duration;
    const duration =
      typeof durationRaw === "number" || typeof durationRaw === "string"
        ? String(durationRaw).trim()
        : "";
    return { beat, vo, duration };
  });
}

function extractTextContent(response: any): string {
  return Array.isArray(response?.content)
    ? response.content
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block?.text ?? ""))
        .join("\n")
        .trim()
    : "";
}

function extractCustomerLanguage(personaRaw: unknown) {
  const root = asObject(personaRaw) ?? {};
  const avatar = asObject(root.avatar) ?? {};
  const success = asObject(root.success_looks_like) ?? asObject(avatar.success_looks_like) ?? {};
  const trigger = asObject(root.buy_trigger) ?? asObject(avatar.buy_trigger) ?? {};
  const landmines = Array.isArray(root.competitor_landmines)
    ? root.competitor_landmines
    : Array.isArray(avatar.competitor_landmines)
      ? avatar.competitor_landmines
      : [];
  const topLandmine = asObject(landmines[0]) ?? {};

  const copyReadyPhrases = Array.from(
    new Set([
      ...asStringArray(root.copy_ready_phrases),
      ...asStringArray(avatar.copy_ready_phrases),
    ]),
  );
  const successLooksLike =
    asString(success.quote) || asString(success.emotional_payoff) || asString(success.outcome);
  const buyTrigger =
    asString(trigger.quote) || asString(trigger.situation) || asString(trigger.trigger);
  const competitorLandmine =
    asString(topLandmine.quote) || asString(topLandmine.what_failed) || asString(topLandmine.impact);

  return {
    copyReadyPhrases,
    successLooksLike,
    buyTrigger,
    competitorLandmine,
  };
}

function extractPatternGuidance(rawJson: unknown) {
  const root = asObject(rawJson) ?? {};
  const patternsRoot = asObject(root.patterns) ?? root;
  const prescriptive = asObject(patternsRoot.prescriptiveGuidance) ?? asObject(root.prescriptiveGuidance) ?? {};
  return {
    psychologicalMechanism:
      asString(prescriptive.psychologicalMechanism) ||
      asString(prescriptive.psychological_mechanism),
    transferFormula: asString(prescriptive.transferFormula) || asString(prescriptive.transfer_formula),
  };
}

function extractProductIntel(payloadRaw: unknown): {
  mechanismProcess: string;
  specificClaims: string[];
  keyFeatures: string[];
} {
  const payload = asObject(payloadRaw) ?? {};
  const result = asObject(payload.result) ?? {};
  const intel = asObject(result.intel) ?? {};

  const mechanismProcess =
    asString(intel.mechanismProcess) ||
    asString(intel.mechanism_process) ||
    asString(intel.process) ||
    [asString(intel.usage), asString(intel.format), asString(intel.main_benefit)]
      .filter((entry): entry is string => Boolean(entry))
      .join("; ");
  const specificClaims = asStringArray(
    intel.specific_claims ?? intel.key_claims ?? intel.keyClaims,
  );
  const keyFeatures = asStringArray(
    intel.key_features ?? intel.keyFeatures,
  );

  return {
    mechanismProcess,
    specificClaims,
    keyFeatures,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { scriptId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const scriptId = String(params?.scriptId ?? "").trim();
    if (!scriptId) {
      return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const beatLabel = asString((body as Record<string, unknown> | null)?.beatLabel);
    const insertionIndex = Number((body as Record<string, unknown> | null)?.insertionIndex);
    const existingScenes = normalizeScenes((body as Record<string, unknown> | null)?.existingScenes);
    const targetDuration = asPositiveInt((body as Record<string, unknown> | null)?.targetDuration, 30);
    const beatCount = asPositiveInt((body as Record<string, unknown> | null)?.beatCount, 5);

    if (!beatLabel) {
      return NextResponse.json({ error: "beatLabel is required" }, { status: 400 });
    }
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0) {
      return NextResponse.json({ error: "insertionIndex must be a non-negative integer" }, { status: 400 });
    }
    if (!Array.isArray((body as Record<string, unknown> | null)?.existingScenes)) {
      return NextResponse.json({ error: "existingScenes array is required" }, { status: 400 });
    }

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
        rawJson: true,
        job: {
          select: {
            runId: true,
          },
        },
      },
    });

    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    const runId = script.job?.runId ?? null;

    let avatarData: ReturnType<typeof extractCustomerLanguage> | null = null;
    let patternData: ReturnType<typeof extractPatternGuidance> | null = null;
    let productData: ReturnType<typeof extractProductIntel> | null = null;

    if (runId) {
      const customerAnalysisJob = await prisma.job.findFirst({
        where: {
          projectId: script.projectId,
          runId,
          type: JobType.CUSTOMER_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          resultSummary: true,
        },
      });
      const summary = asObject(customerAnalysisJob?.resultSummary) ?? {};
      const avatarId = asString(summary.avatarId) || asString(summary.avatar_id);
      if (avatarId) {
        const avatar = await prisma.customerAvatar.findFirst({
          where: { id: avatarId, projectId: script.projectId },
          select: {
            persona: true,
          },
        });
        if (avatar?.persona) {
          avatarData = extractCustomerLanguage(avatar.persona);
        }
      }

      const patternResult = await prisma.adPatternResult.findFirst({
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
      if (patternResult?.rawJson) {
        patternData = extractPatternGuidance(patternResult.rawJson);
      }

      const productCollectionJob = await prisma.job.findFirst({
        where: {
          projectId: script.projectId,
          runId,
          type: JobType.PRODUCT_DATA_COLLECTION,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          payload: true,
        },
      });
      if (productCollectionJob?.payload) {
        productData = extractProductIntel(productCollectionJob.payload);
      }
    }

    const hasAvatarData = Boolean(
      avatarData &&
        (avatarData.copyReadyPhrases.length > 0 ||
          avatarData.successLooksLike ||
          avatarData.buyTrigger ||
          avatarData.competitorLandmine),
    );
    const hasPatternData = Boolean(
      patternData && (patternData.psychologicalMechanism || patternData.transferFormula),
    );
    const hasProductData = Boolean(
      productData &&
        (productData.mechanismProcess ||
          productData.specificClaims.length > 0 ||
          productData.keyFeatures.length > 0),
    );
    const populatedSourceCount = [hasAvatarData, hasPatternData, hasProductData].filter(Boolean).length;
    const dataQuality =
      populatedSourceCount === 3 ? "full" : populatedSourceCount > 0 ? "partial" : "minimal";

    const safeBeatCount = Math.max(1, beatCount);
    const secondsPerBeat = Math.max(1, Math.round(targetDuration / safeBeatCount));
    const wordCeiling = Math.max(8, Math.round((secondsPerBeat / 60) * 135 * 0.9));
    const surroundingBeats = existingScenes
      .map((scene) => `${scene.beat || "Beat"}: ${scene.vo || ""}`)
      .join("\n");

    const promptSections: string[] = [];
    promptSections.push(
      `You are writing one beat for a UGC video script. The new beat is called ${beatLabel} and sits at position ${insertionIndex} of ${safeBeatCount}. It owns ${secondsPerBeat} seconds and must stay under ${wordCeiling} words. Here are the surrounding beats:\n${surroundingBeats}\nWrite VO that sounds like the same person who wrote the surrounding beats. Return only the VO text, nothing else.`,
    );

    if (hasPatternData && patternData) {
      promptSections.push(
        `The script has an established psychological contract with the viewer using these mechanisms: ${patternData.psychologicalMechanism || "unspecified"} and this formula: ${patternData.transferFormula || "unspecified"}. The new beat must honor this contract.`,
      );
    }
    if (hasAvatarData && avatarData) {
      promptSections.push(
        `Use language from these customer phrases where natural: ${avatarData.copyReadyPhrases.join(", ") || "none provided"}. The payoff emotional outcome is: ${avatarData.successLooksLike || "unspecified"}. The trigger situation is: ${avatarData.buyTrigger || "unspecified"}.`,
      );
    }
    if (hasProductData && productData) {
      promptSections.push(
        `Reference product facts only from these verified sources. Mechanism: ${productData.mechanismProcess || "unspecified"}. Claims: ${productData.specificClaims.join("; ") || "none provided"}. Features: ${productData.keyFeatures.join(", ") || "none provided"}. Never invent statistics. If no numeric claim fits this beat use emotional language instead.`,
      );
    }

    const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }

    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 30_000,
    });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: promptSections.join("\n\n") }],
    });

    const vo = extractTextContent(response);
    if (!vo) {
      return NextResponse.json({ error: "Claude returned empty beat output" }, { status: 500 });
    }

    return NextResponse.json(
      {
        vo,
        dataQuality,
        beatLabel,
        insertionIndex,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to generate beat" },
      { status: 500 },
    );
  }
}
