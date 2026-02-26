import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type CharacterInfo = {
  name: string | null;
  description: string | null;
};

const characterByIdCache = new Map<string, CharacterInfo | null>();
const characterByRunProductCache = new Map<string, CharacterInfo | null>();
const characterByProductCache = new Map<string, CharacterInfo | null>();

async function lookupCharacterById(characterId: string): Promise<CharacterInfo | null> {
  if (characterByIdCache.has(characterId)) return characterByIdCache.get(characterId) ?? null;
  const row = await prisma.character.findFirst({
    where: { id: characterId },
    select: { name: true, creatorVisualPrompt: true },
  });
  const value = row
    ? {
        name: asString(row.name),
        description: asString(row.creatorVisualPrompt),
      }
    : null;
  characterByIdCache.set(characterId, value);
  return value;
}

async function lookupCharacterByRunAndProduct(
  runId: string,
  productId: string,
): Promise<CharacterInfo | null> {
  const cacheKey = `${runId}:${productId}`;
  if (characterByRunProductCache.has(cacheKey)) {
    return characterByRunProductCache.get(cacheKey) ?? null;
  }
  const row = await prisma.character.findFirst({
    where: { runId, productId },
    orderBy: { createdAt: "desc" },
    select: { name: true, creatorVisualPrompt: true },
  });
  const value = row
    ? {
        name: asString(row.name),
        description: asString(row.creatorVisualPrompt),
      }
    : null;
  characterByRunProductCache.set(cacheKey, value);
  return value;
}

async function lookupCharacterByProduct(productId: string): Promise<CharacterInfo | null> {
  if (characterByProductCache.has(productId)) return characterByProductCache.get(productId) ?? null;
  const row = await prisma.character.findFirst({
    where: { productId },
    orderBy: { createdAt: "desc" },
    select: { name: true, creatorVisualPrompt: true },
  });
  const value = row
    ? {
        name: asString(row.name),
        description: asString(row.creatorVisualPrompt),
      }
    : null;
  characterByProductCache.set(productId, value);
  return value;
}

async function resolveCharacterInfo(payload: Record<string, unknown>): Promise<CharacterInfo | null> {
  const characterId = asString(payload.characterId);
  if (characterId) {
    const byId = await lookupCharacterById(characterId);
    if (byId?.name || byId?.description) return byId;
  }
  const runId = asString(payload.runId);
  const productId = asString(payload.productId);
  if (runId && productId) {
    const byRunProduct = await lookupCharacterByRunAndProduct(runId, productId);
    if (byRunProduct?.name || byRunProduct?.description) return byRunProduct;
  }
  if (productId) {
    const byProduct = await lookupCharacterByProduct(productId);
    if (byProduct?.name || byProduct?.description) return byProduct;
  }
  return null;
}

async function main() {
  const scenes = await prisma.storyboardScene.findMany({
    select: {
      id: true,
      rawJson: true,
      storyboard: {
        select: {
          script: {
            select: {
              job: {
                select: {
                  payload: true,
                },
              },
            },
          },
        },
      },
    },
  });

  let updated = 0;
  let removedLegacyHandle = 0;
  let filteredHandleSuggestion = 0;
  let backfilledName = 0;
  let backfilledDescription = 0;
  let unresolvedCharacterInfo = 0;

  for (const scene of scenes) {
    const raw = asObject(scene.rawJson) ?? {};
    const next: Record<string, unknown> = { ...raw };
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(next, "characterHandle")) {
      delete next.characterHandle;
      changed = true;
      removedLegacyHandle += 1;
    }
    if (Object.prototype.hasOwnProperty.call(next, "Character Handle")) {
      delete next["Character Handle"];
      changed = true;
      removedLegacyHandle += 1;
    }

    if (Array.isArray(next.bRollSuggestions)) {
      const before = next.bRollSuggestions.length;
      const filtered = next.bRollSuggestions
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .filter((entry) => !/^character\s*handle\s*:/i.test(entry));
      if (filtered.length !== before) {
        next.bRollSuggestions = filtered;
        changed = true;
        filteredHandleSuggestion += before - filtered.length;
      }
    }

    const currentCharacterName = asString(next.characterName);
    const currentCharacterDescription = asString(next.characterDescription);

    if (!currentCharacterName || !currentCharacterDescription) {
      const payload = asObject(scene.storyboard?.script?.job?.payload) ?? {};
      const resolved = await resolveCharacterInfo(payload);

      if (!currentCharacterName && resolved?.name) {
        next.characterName = resolved.name;
        changed = true;
        backfilledName += 1;
      }

      if (!currentCharacterDescription) {
        const resolvedDescription = resolved?.description || asString(next.characterAnchor);
        if (resolvedDescription) {
          next.characterDescription = resolvedDescription;
          changed = true;
          backfilledDescription += 1;
        }
      }

      if (!asString(next.characterName) || !asString(next.characterDescription)) {
        unresolvedCharacterInfo += 1;
      }
    }

    if (!changed) continue;

    await prisma.storyboardScene.update({
      where: { id: scene.id },
      data: {
        rawJson: next,
      },
    });
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        scanned: scenes.length,
        updated,
        removedLegacyHandle,
        filteredHandleSuggestion,
        backfilledName,
        backfilledDescription,
        unresolvedCharacterInfo,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[cleanup_storyboard_legacy_character_fields] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
