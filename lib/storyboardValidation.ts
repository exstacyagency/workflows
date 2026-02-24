type StoryboardPanelForValidation = {
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
  panelType?: "ON_CAMERA" | "B_ROLL_ONLY" | null;
  characterAction: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  transitionType: string;
};

export type StoryboardValidationReport = {
  gatesPassed: boolean;
  warnings: string[];
  qualityScore: number;
  gateResults: {
    textOverlayTiming: {
      passed: boolean;
      missingPanelIndexes: number[];
    };
    productPlacementTiming: {
      passed: boolean;
      missingPanelIndexes: number[];
    };
    panelTypeRequirements: {
      passed: boolean;
      bRollOnlyMissingShotBreakdownPanelIndexes: number[];
      onCameraGenericCharacterActionPanelIndexes: number[];
    };
  };
};

function hasExplicitTiming(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const hasRange = /\d+(?:\.\d+)?\s*s?\s*-\s*\d+(?:\.\d+)?\s*s?/i.test(normalized);
  const hasSingleSecond = /\b\d+(?:\.\d+)?\s*s\b/i.test(normalized);
  const hasAtSecond = /\bat\s*\d+(?:\.\d+)?\s*s\b/i.test(normalized);
  return hasRange || hasSingleSecond || hasAtSecond;
}

function hasTextOverlayWithTiming(entries: string[]): boolean {
  return entries.some((entry) => {
    const normalized = String(entry ?? "").trim();
    if (!normalized) return false;
    const hasOverlayLabel = /text\s*overlay/i.test(normalized);
    if (!hasOverlayLabel) return false;
    return hasExplicitTiming(normalized);
  });
}

function hasExplicitShotDescription(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  const shotKeywords = [
    "shot",
    "close-up",
    "closeup",
    "wide",
    "cutaway",
    "overlay",
    "frame",
    "camera",
    "pan",
    "tilt",
    "zoom",
    "hands",
    "product",
    "screen",
    "insert",
    "match cut",
  ];

  return shotKeywords.some((keyword) => normalized.includes(keyword));
}

export function validateStoryboardAgainstGates(
  panels: StoryboardPanelForValidation[],
): StoryboardValidationReport {
  const missingTextOverlayTiming = panels
    .map((panel, index) => {
      const valid = hasTextOverlayWithTiming(Array.isArray(panel.bRollSuggestions) ? panel.bRollSuggestions : []);
      return valid ? null : index + 1;
    })
    .filter((index): index is number => typeof index === "number");

  const missingProductPlacementTiming = panels
    .map((panel, index) => (hasExplicitTiming(panel.productPlacement) ? null : index + 1))
    .filter((index): index is number => typeof index === "number");

  const bRollOnlyMissingShotBreakdownPanels = panels
    .map((panel, index) => {
      const panelType = panel.panelType === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
      if (panelType !== "B_ROLL_ONLY") return null;
      const suggestions = Array.isArray(panel.bRollSuggestions) ? panel.bRollSuggestions : [];
      const explicitSuggestions = suggestions.filter((entry) => hasExplicitShotDescription(entry));
      return explicitSuggestions.length >= 3 ? null : index + 1;
    })
    .filter((index): index is number => typeof index === "number");

  const onCameraGenericCharacterActionPanels: number[] = [];

  const gate1Passed = missingTextOverlayTiming.length === 0;
  const gate2Passed = missingProductPlacementTiming.length === 0;
  const gate3Passed =
    bRollOnlyMissingShotBreakdownPanels.length === 0 &&
    onCameraGenericCharacterActionPanels.length === 0;

  const warnings: string[] = [];
  if (!gate1Passed) {
    warnings.push(
      `Text overlay timing gate failed: panels missing explicit TEXT OVERLAY timing (${missingTextOverlayTiming.join(", ")}).`,
    );
  }
  if (!gate2Passed) {
    warnings.push(
      `Product placement timing gate failed: panels missing exact seconds (${missingProductPlacementTiming.join(", ")}).`,
    );
  }
  if (!gate3Passed) {
    const details: string[] = [];
    if (bRollOnlyMissingShotBreakdownPanels.length > 0) {
      details.push(`B_ROLL_ONLY panels need >=3 explicit shot descriptions (${bRollOnlyMissingShotBreakdownPanels.join(", ")})`);
    }
    if (onCameraGenericCharacterActionPanels.length > 0) {
      details.push(`ON_CAMERA panels have generic characterAction (${onCameraGenericCharacterActionPanels.join(", ")})`);
    }
    warnings.push(
      `Panel type requirements gate failed: ${details.join("; ")}.`,
    );
  }

  const passedCount = [gate1Passed, gate2Passed, gate3Passed].filter(Boolean).length;
  const qualityScore = Math.max(0, Math.min(100, Math.round((passedCount / 3) * 100)));

  return {
    gatesPassed: warnings.length === 0,
    warnings,
    qualityScore,
    gateResults: {
      textOverlayTiming: {
        passed: gate1Passed,
        missingPanelIndexes: missingTextOverlayTiming,
      },
      productPlacementTiming: {
        passed: gate2Passed,
        missingPanelIndexes: missingProductPlacementTiming,
      },
      panelTypeRequirements: {
        passed: gate3Passed,
        bRollOnlyMissingShotBreakdownPanelIndexes: bRollOnlyMissingShotBreakdownPanels,
        onCameraGenericCharacterActionPanelIndexes: onCameraGenericCharacterActionPanels,
      },
    },
  };
}
