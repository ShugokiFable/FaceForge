import { describe, expect, it } from "vitest";
import type { AppearanceChoice } from "./nativeBridge";
import {
  installHasHighPolyHeadFace,
  isHighPolyHeadChoice,
  preferHeadPart,
  scoreHeadPartPreference
} from "./headPartPreferences";

const choice = (
  partial: Partial<AppearanceChoice> &
    Pick<AppearanceChoice, "category" | "displayName" | "formIdentifier" | "pluginName">
): AppearanceChoice => ({
  editorId: partial.editorId ?? null,
  sourceMod: partial.sourceMod ?? null,
  masters: partial.masters ?? [],
  missingMasters: partial.missingMasters ?? [],
  matchEvidence: partial.matchEvidence ?? "test",
  sex: partial.sex ?? "female",
  playable: partial.playable ?? true,
  validRacesEditorId: partial.validRacesEditorId ?? null,
  validRaces: partial.validRaces ?? ["NordRace"],
  typeFromRecord: partial.typeFromRecord ?? true,
  ...partial
});

describe("head part preferences", () => {
  it("detects High Poly Head face meshes from plugin and source names", () => {
    const hph = choice({
      category: "face",
      displayName: "FemaleHead",
      formIdentifier: "High Poly Head.esm|000A06",
      pluginName: "High Poly Head.esm",
      sourceMod: "High Poly Head"
    });
    const vanilla = choice({
      category: "face",
      displayName: "FemaleHeadNord",
      formIdentifier: "Skyrim.esm|05150F",
      pluginName: "Skyrim.esm",
      sourceMod: "Skyrim base game"
    });
    expect(isHighPolyHeadChoice(hph)).toBe(true);
    expect(isHighPolyHeadChoice(vanilla)).toBe(false);
    expect(installHasHighPolyHeadFace([vanilla, hph])).toBe(true);
    expect(scoreHeadPartPreference(hph)).toBeGreaterThan(scoreHeadPartPreference(vanilla));
  });

  it("prefers High Poly Head over vanilla for the active race and sex", () => {
    const vanilla = choice({
      category: "face",
      displayName: "FemaleHeadNord",
      formIdentifier: "Skyrim.esm|05150F",
      pluginName: "Skyrim.esm",
      sex: "female",
      validRaces: ["NordRace"]
    });
    const hph = choice({
      category: "face",
      displayName: "FemaleHead",
      formIdentifier: "High Poly Head.esm|000A06",
      pluginName: "High Poly Head.esm",
      sourceMod: "High Poly Head SE",
      sex: "female",
      validRaces: ["NordRace", "BretonRace"]
    });
    const maleHph = choice({
      category: "face",
      displayName: "MaleHead",
      formIdentifier: "High Poly Head.esm|000B01",
      pluginName: "High Poly Head.esm",
      sex: "male",
      validRaces: ["NordRace"]
    });
    const preferred = preferHeadPart([vanilla, maleHph, hph], "face", "NordRace", "female");
    expect(preferred?.formIdentifier).toBe("High Poly Head.esm|000A06");
  });

  it("returns null when nothing fits the race/sex filter", () => {
    const onlyMale = choice({
      category: "face",
      displayName: "MaleHead",
      formIdentifier: "High Poly Head.esm|000B01",
      pluginName: "High Poly Head.esm",
      sex: "male",
      validRaces: ["NordRace"]
    });
    expect(preferHeadPart([onlyMale], "face", "NordRace", "female")).toBeNull();
  });
});
