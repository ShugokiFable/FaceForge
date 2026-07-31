import type { AppearanceCategory, AppearanceChoice, AppearanceSex } from "./nativeBridge";

export type TargetSex = "male" | "female";

/** Skyrim only restricts a head part when it sets a gender flag; unflagged parts fit both. */
export const fitsSex = (sex: AppearanceSex, target: TargetSex) =>
  sex === "any" || sex === "unflagged" || sex === target;

/**
 * An empty validRaces list means the ValidRaces form list could not be resolved from installed
 * plugins, not that the part is valid for nothing.
 */
export const fitsRace = (validRaces: readonly string[], target: string | null) =>
  !target || validRaces.length === 0 || validRaces.includes(target);

const haystackOf = (choice: AppearanceChoice): string =>
  [
    choice.pluginName,
    choice.displayName,
    choice.editorId ?? "",
    choice.sourceMod ?? "",
    choice.formIdentifier
  ]
    .join(" ")
    .toLowerCase();

/**
 * True when the install evidence points at Kalilies' High Poly Head (plugin name, Vortex source
 * mod, or the classic KL\High Poly Head mesh path baked into related records' provenance).
 */
export function isHighPolyHeadChoice(choice: AppearanceChoice): boolean {
  const hay = haystackOf(choice);
  return (
    hay.includes("high poly head") ||
    hay.includes("highpolyhead") ||
    hay.includes("highpoly head") ||
    /(?:^|[^a-z])hph(?:[^a-z]|$)/.test(hay) ||
    hay.includes("kl\\high poly") ||
    hay.includes("kl/high poly")
  );
}

/** Whether the indexed install offers at least one High Poly Head face mesh for some race/sex. */
export function installHasHighPolyHeadFace(
  choices: readonly AppearanceChoice[]
): boolean {
  return choices.some(
    (choice) => choice.category === "face" && isHighPolyHeadChoice(choice)
  );
}

/**
 * Preference score for auto-picking a head part once the index knows what the user installed.
 * Higher wins. High Poly Head outranks vanilla and generic replacers because modern preset packs
 * (and EFM sculpt hosts) almost always sit on the HPH topology.
 */
export function scoreHeadPartPreference(choice: AppearanceChoice): number {
  let score = 0;
  const hay = haystackOf(choice);
  if (isHighPolyHeadChoice(choice)) score += 120;
  // Related HPH companion packs (brows, etc.) still beat vanilla for the same slot.
  if (hay.includes("high poly") || hay.includes("highpoly")) score += 40;
  if (choice.playable) score += 8;
  if (choice.missingMasters.length === 0) score += 12;
  if (choice.typeFromRecord) score += 4;
  if (choice.validRaces.length > 0) score += 6;
  // Prefer records that declare a real race list match later via fitsRace; unresolved stays usable.
  const plugin = choice.pluginName.toLowerCase();
  if (plugin === "skyrim.esm" || plugin === "update.esm") score -= 25;
  if (plugin === "dawnguard.esm" || plugin === "dragonborn.esm") score -= 15;
  return score;
}

export function filterHeadPartsForTarget(
  choices: readonly AppearanceChoice[],
  category: AppearanceCategory,
  targetRace: string | null,
  targetSex: TargetSex
): AppearanceChoice[] {
  return choices.filter(
    (choice) =>
      choice.category === category &&
      fitsSex(choice.sex, targetSex) &&
      fitsRace(choice.validRaces, targetRace)
  );
}

/**
 * Best installed part for a slot given race/sex. Returns null when the index has nothing usable.
 * Callers should only auto-apply when the user has not manually locked that category.
 */
export function preferHeadPart(
  choices: readonly AppearanceChoice[],
  category: AppearanceCategory,
  targetRace: string | null,
  targetSex: TargetSex
): AppearanceChoice | null {
  const fitted = filterHeadPartsForTarget(choices, category, targetRace, targetSex);
  if (fitted.length === 0) return null;
  return [...fitted].sort((a, b) => {
    const delta = scoreHeadPartPreference(b) - scoreHeadPartPreference(a);
    if (delta !== 0) return delta;
    return a.displayName.localeCompare(b.displayName);
  })[0];
}

/**
 * Categories FaceForge may auto-fill from the index. Face is mandatory for HPH support; brows
 * follow when an HPH-linked brow pack is installed so the head and brows share topology.
 */
export const AUTO_PREFER_CATEGORIES: readonly AppearanceCategory[] = ["face", "brows"];

export function describeInstallHeadCapabilities(
  choices: readonly AppearanceChoice[]
): string[] {
  const notes: string[] = [];
  if (installHasHighPolyHeadFace(choices)) {
    notes.push(
      "High Poly Head face mesh detected — FaceForge will prefer it for photo-built presets."
    );
  } else {
    notes.push(
      "No High Poly Head face mesh in the index. Install High Poly Head (and redeploy) for the topology modern presets expect."
    );
  }
  const faceCount = choices.filter((choice) => choice.category === "face").length;
  if (faceCount > 0) {
    notes.push(`${faceCount.toLocaleString()} face/head mesh record(s) indexed from your plugins.`);
  }
  return notes;
}
