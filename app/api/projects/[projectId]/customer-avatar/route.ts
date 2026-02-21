// app/api/projects/[projectId]/customer-avatar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { JobStatus, JobType } from '@prisma/client';

type Params = {
  params: { projectId: string };
};

function serializeAvatar(record: any) {
  const { persona, ...safe } = record;
  return { ...safe, hasPersona: Boolean(persona) };
}

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

function inferAgeRangeFromLifeStage(lifeStage: string | null): string | null {
  const text = asString(lifeStage).toLowerCase();
  if (!text) return null;
  if (/student|college|campus|grad/.test(text)) return "18-24";
  if (/young professional|early[-\s]?career|entry[-\s]?level/.test(text)) return "22-30";
  if (/performance[-\s]?driven professional|working professional|busy professional|career/.test(text)) {
    return "30-45";
  }
  if (/parent|mom|mum|dad|family|kids/.test(text)) return "28-45";
  if (/mid[-\s]?career|established professional/.test(text)) return "35-50";
  if (/retiree|retired|senior/.test(text)) return "55+";
  return null;
}

function normalizeGender(...sources: Array<unknown>): string | null {
  const joined = sources.map((source) => asString(source)).join(" ").toLowerCase();
  if (!joined) return null;
  if (/\bnon[-\s]?binary\b/.test(joined)) return "non-binary person";
  if (/\bfemale\b|\bwoman\b|\bwomen\b/.test(joined)) return "woman";
  if (/\bmale\b|\bman\b|\bmen\b/.test(joined)) return "man";
  return null;
}

function normalizeLifestyleAttribute(raw: string): string | null {
  const text = asString(raw).toLowerCase();
  if (!text) return null;
  if (/professional|career|corporate|office|business/.test(text)) return "professional";
  if (/athletic|fitness|active|gym|sport|runner/.test(text)) return "athletic";
  if (/parent|family|kids|caregiver/.test(text)) return "family-oriented";
  if (/student|college/.test(text)) return "student";
  if (/entrepreneur|founder|startup|owner/.test(text)) return "entrepreneurial";
  if (/creative|artist|designer/.test(text)) return "creative";
  if (/style|fashion/.test(text)) return "style-conscious";
  return text;
}

function inferVisualStyle(args: {
  explicitVisualStyle: string | null;
  lifestyleAttributes: string[];
  lifeStage: string | null;
}): string | null {
  const explicit = asString(args.explicitVisualStyle);
  if (explicit) return explicit;
  const attrs = args.lifestyleAttributes;
  if (attrs.includes("professional") || /professional|career|corporate/.test(asString(args.lifeStage).toLowerCase())) {
    return "business casual";
  }
  if (attrs.includes("athletic")) return "active wear";
  if (attrs.includes("student")) return "smart casual";
  if (attrs.includes("family-oriented")) return "casual everyday";
  if (attrs.includes("style-conscious")) return "modern casual";
  return null;
}

function buildCreatorDescriptionFromAvatar(persona: unknown): {
  creatorDescription: string;
  hasSeedSignals: boolean;
  demographics: {
    age: string | null;
    gender: string | null;
    lifestyleAttributes: string[];
    lifeStage: string | null;
    visualStyle: string | null;
  };
} {
  const root = asObject(persona) ?? {};
  const avatar = asObject(root.avatar) ?? {};
  const profile = asObject(avatar.profile) ?? {};
  const demographics = asObject(avatar.demographics) ?? asObject(root.demographics) ?? {};
  const psychographics = asObject(root.psychographics) ?? {};

  const explicitAge =
    asString(demographics.age_range) ||
    asString(demographics.ageRange) ||
    asString(demographics.age) ||
    asString(root.age_range) ||
    asString(root.ageRange) ||
    asString(root.age) ||
    "";
  const lifeStage =
    asString(profile.life_stage) ||
    asString(profile.lifeStage) ||
    asString(avatar.life_stage) ||
    asString(avatar.lifeStage) ||
    asString(root.life_stage) ||
    asString(root.lifeStage) ||
    null;
  const age = explicitAge || inferAgeRangeFromLifeStage(lifeStage);
  const gender = normalizeGender(
    demographics.gender,
    root.gender,
    profile.gender,
    lifeStage,
  );
  const rawLifestyleAttributes = [
    ...asStringArray(demographics.lifestyle_attributes),
    ...asStringArray(demographics.lifestyleAttributes),
    ...asStringArray(avatar.lifestyle_attributes),
    ...asStringArray(avatar.lifestyleAttributes),
    ...asStringArray(root.lifestyle_attributes),
    ...asStringArray(root.lifestyleAttributes),
    ...asStringArray(psychographics.lifestyle),
    ...asStringArray(psychographics.attributes),
    asString(lifeStage),
  ];
  const lifestyleAttributes = Array.from(
    new Set(
      rawLifestyleAttributes
        .map((value) => normalizeLifestyleAttribute(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 6);
  const visualStyle = inferVisualStyle({
    explicitVisualStyle:
      asString(avatar.visual_style) ||
      asString(avatar.visualStyle) ||
      asString(root.visual_style) ||
      asString(root.visualStyle) ||
      asString(profile.visual_style) ||
      asString(profile.visualStyle) ||
      null,
    lifestyleAttributes,
    lifeStage,
  });

  const hasSeedSignals = Boolean(
    age ||
      gender ||
      lifeStage ||
      visualStyle ||
      lifestyleAttributes.length > 0,
  );
  const profileBits = [
    age ? `${age} year old` : null,
    gender,
    lifestyleAttributes[0] ?? null,
  ].filter((value): value is string => Boolean(value));
  const profileText = profileBits.length > 0 ? profileBits.join(" ") : null;
  const styleText = visualStyle ? `${visualStyle} attire` : null;

  const lines: string[] = [];
  if (profileText) {
    lines.push(`Creator profile: ${profileText} creator.`);
  }
  if (lifestyleAttributes.length > 0) {
    lines.push(`Lifestyle attributes: ${lifestyleAttributes.join(", ")}.`);
  }
  if (lifeStage) {
    lines.push(`Life stage context: ${lifeStage}.`);
  }
  if (styleText) {
    lines.push(`Visual style: ${styleText}.`);
  }
  if (hasSeedSignals) {
    lines.push("Expression: confident and approachable. Demeanor: trustworthy.");
  }

  return {
    creatorDescription: lines.join(" ").replace(/\s+/g, " ").trim(),
    hasSeedSignals,
    demographics: {
      age,
      gender,
      lifestyleAttributes,
      lifeStage,
      visualStyle,
    },
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const productId = req.nextUrl.searchParams.get('productId')?.trim() || '';
  if (productId) {
    const ownedProduct = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "product"
      WHERE "id" = ${productId}
        AND "project_id" = ${projectId}
      LIMIT 1
    `;
    if (!ownedProduct[0]?.id) {
      return NextResponse.json({ error: 'Product not found for this project' }, { status: 404 });
    }

    const latestCustomerAnalysisJob = await prisma.$queryRaw<Array<{
      id: string;
      payload: unknown;
      createdAt: Date;
    }>>`
      SELECT
        "id",
        "payload" AS "payload",
        "createdAt" AS "createdAt"
      FROM "job"
      WHERE "projectId" = ${projectId}
        AND "type" = CAST(${JobType.CUSTOMER_ANALYSIS} AS "JobType")
        AND "status" = CAST(${JobStatus.COMPLETED} AS "JobStatus")
        AND COALESCE("payload"->>'productId', '') = ${productId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    const analysisJob = latestCustomerAnalysisJob[0];
    if (!analysisJob) {
      return NextResponse.json(
        { error: 'No customer research found for this product' },
        { status: 404 },
      );
    }

    const analysisPayload = asObject(analysisJob.payload) ?? {};
    const analysisResult = asObject(analysisPayload.result) ?? {};
    const analysisPersona = asObject(analysisResult.persona);
    const analysisAvatarSection = asObject(analysisPersona?.avatar);
    if (!analysisPersona || !analysisAvatarSection) {
      return NextResponse.json(
        { error: 'Latest customer analysis has no avatar data for this product' },
        { status: 404 },
      );
    }

    const parsed = buildCreatorDescriptionFromAvatar(analysisPersona);
    if (!parsed.hasSeedSignals) {
      return NextResponse.json(
        { error: 'Latest customer analysis has no avatar data for this product' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        id: analysisJob.id,
        productId,
        sourceJobId: analysisJob.id,
        createdAt: analysisJob.createdAt,
        creatorDescription: parsed.creatorDescription,
        demographics: parsed.demographics,
      },
      { status: 200 },
    );
  }

  const view = req.nextUrl.searchParams.get('view');
  if (view === 'all') {
    const avatars = await prisma.customerAvatar.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(avatars.map(serializeAvatar), { status: 200 });
  }

  const desiredId = req.nextUrl.searchParams.get('id');
  let avatar = null;
  if (desiredId) {
    avatar = await prisma.customerAvatar.findFirst({ where: { id: desiredId, projectId } });
  }

  if (!avatar) {
    const all = await prisma.customerAvatar.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    avatar = all.find((a) => !(a.persona as any)?.archivedAt) ?? all[0] ?? null;
  }

  if (!avatar) {
    return NextResponse.json(
      { error: 'No customer avatar found for this project' },
      { status: 404 },
    );
  }

  const download = req.nextUrl.searchParams.get('download');
  if (download === '1') {
    const payload = avatar.persona ?? avatar;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${projectId}-customer-avatar-${avatar.id}.json"`,
      },
    });
  }

  return NextResponse.json(serializeAvatar(avatar), { status: 200 });
}
