import type { Prisma } from "@prisma/client";

type DeleteManyResult = { count: number };

export type ProjectPurgePreview = {
  projectId: string;
  projectName: string;
  confirmationPhrase: string;
  counts: {
    jobs: number;
    researchRuns: number;
    researchRows: number;
    amazonReviews: number;
    adAssets: number;
    adPatternResults: number;
    adPatternReferences: number;
    storyboards: number;
    storyboardScenes: number;
    imagePrompts: number;
    scripts: number;
    characters: number;
    customerAvatars: number;
    productIntels: number;
    productIntelligences: number;
    usageEvents: number;
    auditLogs: number;
    products: number;
  };
};

export type ProjectPurgeResult = {
  projectId: string;
  deleted: ProjectPurgePreview["counts"] & {
    project: 1;
  };
};

export function buildProjectPurgeConfirmationPhrase(projectName: string) {
  return `DELETE PROJECT ${projectName}`;
}

export async function getProjectPurgePreview(args: {
  tx: Prisma.TransactionClient;
  projectId: string;
  projectName: string;
}): Promise<ProjectPurgePreview> {
  const { tx, projectId, projectName } = args;
  const [
    jobs,
    researchRuns,
    researchRows,
    amazonReviews,
    adAssets,
    adPatternResults,
    adPatternReferences,
    storyboards,
    storyboardScenes,
    imagePrompts,
    scripts,
    characters,
    customerAvatars,
    productIntels,
    productIntelligences,
    usageEvents,
    auditLogs,
    products,
  ] = await Promise.all([
    tx.job.count({ where: { projectId } }),
    tx.researchRun.count({ where: { projectId } }),
    tx.researchRow.count({ where: { projectId } }),
    tx.amazonReview.count({ where: { projectId } }),
    tx.adAsset.count({ where: { projectId } }),
    tx.adPatternResult.count({ where: { projectId } }),
    tx.adPatternReference.count({ where: { projectId } }),
    tx.storyboard.count({ where: { projectId } }),
    tx.storyboardScene.count({ where: { storyboard: { projectId } } }),
    tx.imagePrompt.count({ where: { storyboard: { projectId } } }),
    tx.script.count({ where: { projectId } }),
    tx.character.count({ where: { projectId } }),
    tx.customerAvatar.count({ where: { projectId } }),
    tx.productIntel.count({ where: { projectId } }),
    tx.productIntelligence.count({ where: { projectId } }),
    tx.usageEvent.count({ where: { projectId } }),
    tx.auditLog.count({ where: { projectId } }),
    tx.product.count({ where: { project_id: projectId } }),
  ]);

  return {
    projectId,
    projectName,
    confirmationPhrase: buildProjectPurgeConfirmationPhrase(projectName),
    counts: {
      jobs,
      researchRuns,
      researchRows,
      amazonReviews,
      adAssets,
      adPatternResults,
      adPatternReferences,
      storyboards,
      storyboardScenes,
      imagePrompts,
      scripts,
      characters,
      customerAvatars,
      productIntels,
      productIntelligences,
      usageEvents,
      auditLogs,
      products,
    },
  };
}

export async function purgeProjectArtifacts(args: {
  tx: Prisma.TransactionClient;
  projectId: string;
}): Promise<ProjectPurgeResult["deleted"]> {
  const { tx, projectId } = args;

  const deletedUsageEvents = await tx.usageEvent.deleteMany({ where: { projectId } });
  const deletedStoryboardScenes = await tx.storyboardScene.deleteMany({
    where: { storyboard: { projectId } },
  });
  const deletedImagePrompts = await tx.imagePrompt.deleteMany({
    where: { storyboard: { projectId } },
  });
  const deletedStoryboards = await tx.storyboard.deleteMany({ where: { projectId } });
  const deletedScripts = await tx.script.deleteMany({ where: { projectId } });
  const deletedCharacters = await tx.character.deleteMany({ where: { projectId } });
  const deletedResearchRows = await tx.researchRow.deleteMany({ where: { projectId } });
  const deletedAmazonReviews = await tx.amazonReview.deleteMany({ where: { projectId } });
  const deletedAdAssets = await tx.adAsset.deleteMany({ where: { projectId } });
  const deletedAdPatternResults = await tx.adPatternResult.deleteMany({ where: { projectId } });
  const deletedAdPatternReferences = await tx.adPatternReference.deleteMany({
    where: { projectId },
  });
  const deletedProductIntels = await tx.productIntel.deleteMany({ where: { projectId } });
  const deletedProductIntelligences = await tx.productIntelligence.deleteMany({
    where: { projectId },
  });
  const deletedCustomerAvatars = await tx.customerAvatar.deleteMany({ where: { projectId } });
  const deletedAuditLogs = await tx.auditLog.deleteMany({ where: { projectId } });
  const deletedJobs = await tx.job.deleteMany({ where: { projectId } });
  const deletedResearchRuns = await tx.researchRun.deleteMany({ where: { projectId } });
  const deletedProducts = await tx.product.deleteMany({ where: { project_id: projectId } });

  await tx.project.delete({ where: { id: projectId } });

  return {
    jobs: deletedJobs.count,
    researchRuns: deletedResearchRuns.count,
    researchRows: deletedResearchRows.count,
    amazonReviews: deletedAmazonReviews.count,
    adAssets: deletedAdAssets.count,
    adPatternResults: deletedAdPatternResults.count,
    adPatternReferences: deletedAdPatternReferences.count,
    storyboards: deletedStoryboards.count,
    storyboardScenes: deletedStoryboardScenes.count,
    imagePrompts: deletedImagePrompts.count,
    scripts: deletedScripts.count,
    characters: deletedCharacters.count,
    customerAvatars: deletedCustomerAvatars.count,
    productIntels: deletedProductIntels.count,
    productIntelligences: deletedProductIntelligences.count,
    usageEvents: deletedUsageEvents.count,
    auditLogs: deletedAuditLogs.count,
    products: deletedProducts.count,
    project: 1,
  };
}
