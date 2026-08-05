import { describe, expect, it } from "vitest";
import {
  baselinesForTarget,
  generateEfmSliders,
  measureFace,
  RESPONSE_GAIN,
  sliderRecord,
  type FaceLandmark
} from "./faceAnalysis";
import {
  HPH_RESPONSE_GAIN,
  hphSculptHostShell,
  responseGainForHead,
  selectedFaceIsHighPolyHead
} from "./hphCalibration";
import type { AppearanceChoice } from "./nativeBridge";

const syntheticFace = (): FaceLandmark[] => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (index: number, x: number, y: number) => {
    points[index] = { x, y, z: 0 };
  };
  set(10, 0.5, 0.12);
  set(152, 0.5, 0.88);
  set(234, 0.22, 0.48);
  set(454, 0.78, 0.48);
  set(33, 0.31, 0.39);
  set(133, 0.41, 0.39);
  set(362, 0.59, 0.39);
  set(263, 0.69, 0.39);
  set(159, 0.36, 0.375);
  set(145, 0.36, 0.405);
  set(386, 0.64, 0.375);
  set(374, 0.64, 0.405);
  set(70, 0.31, 0.33);
  set(107, 0.41, 0.325);
  set(336, 0.59, 0.325);
  set(300, 0.69, 0.33);
  set(168, 0.5, 0.42);
  set(1, 0.5, 0.57);
  set(2, 0.5, 0.61);
  set(98, 0.43, 0.59);
  set(327, 0.57, 0.59);
  set(61, 0.39, 0.7);
  set(291, 0.61, 0.7);
  set(0, 0.5, 0.685);
  set(13, 0.5, 0.7);
  set(14, 0.5, 0.705);
  set(17, 0.5, 0.725);
  set(123, 0.25, 0.5);
  set(352, 0.75, 0.5);
  set(122, 0.44, 0.46);
  set(351, 0.56, 0.46);
  set(45, 0.46, 0.56);
  set(275, 0.54, 0.56);
  set(37, 0.47, 0.675);
  set(267, 0.53, 0.675);
  set(155, 0.41, 0.405);
  set(382, 0.59, 0.405);
  set(144, 0.31, 0.405);
  set(373, 0.69, 0.405);
  set(172, 0.28, 0.69);
  set(397, 0.72, 0.69);
  set(148, 0.43, 0.84);
  set(377, 0.57, 0.84);
  return points;
};

describe("HPH calibration", () => {
  /**
   * Replaces the 0.16.0 test that asserted HPH must push harder. That test encoded the defect as
   * a requirement: the gain rise and the baseline multipliers behind it were inferred from author
   * *output*, not from the HPH mesh, and they biased a neutral face by up to 0.55 before any real
   * deviation was measured. Selecting a head mesh must not rescale the measurement of a face.
   */
  it("measures a face the same way whichever head mesh is selected", () => {
    expect(responseGainForHead(false)).toBe(RESPONSE_GAIN);
    expect(responseGainForHead(true)).toBe(RESPONSE_GAIN);
    expect(HPH_RESPONSE_GAIN).toBe(RESPONSE_GAIN);

    const plain = baselinesForTarget("NordRace", "female", false, "none", false);
    const hph = baselinesForTarget("NordRace", "female", false, "none", true);
    expect(hph).toEqual(plain);

    const analysis = measureFace(syntheticFace());
    const off = sliderRecord(
      generateEfmSliders(analysis, null, "NordRace", "female", false, "none", false)
    );
    const on = sliderRecord(
      generateEfmSliders(analysis, null, "NordRace", "female", false, "none", true)
    );
    expect(on).toEqual(off);
  });

  it("detects HPH from selected face appearance and builds empty host shells", () => {
    const face: AppearanceChoice = {
      category: "face",
      displayName: "FemaleHead",
      editorId: "FemaleHead",
      formIdentifier: "High Poly Head.esm|000A06",
      pluginName: "High Poly Head.esm",
      sourceMod: "High Poly Head",
      masters: ["Skyrim.esm"],
      missingMasters: [],
      matchEvidence: "test",
      sex: "female",
      playable: true,
      validRacesEditorId: null,
      validRaces: ["NordRace"],
      typeFromRecord: true
    };
    expect(selectedFaceIsHighPolyHead([face])).toBe(true);
    const shell = hphSculptHostShell("female");
    expect(shell.every((entry) => entry.data.length === 0)).toBe(true);
    expect(shell.map((e) => e.host)).toEqual([
      "KL\\High Poly Head\\FemaleHeadCharGen.tri",
      "KL\\High Poly Head\\FaceParts\\FemaleHeadBrowsCharGen.tri",
      "Actors\\Character\\Character Assets\\EyesFemaleChargen.tri"
    ]);
    expect(shell.map((e) => e.vertices)).toEqual([3832, 371, 176]);
    const male = hphSculptHostShell("male");
    expect(male).toHaveLength(1);
    expect(male[0].host).toMatch(/MaleHeadCharGen/i);
    expect(male[0].data).toEqual([]);
  });
});
