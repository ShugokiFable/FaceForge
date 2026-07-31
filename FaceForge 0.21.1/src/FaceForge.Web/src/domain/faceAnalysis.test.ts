import { describe, expect, it } from "vitest";
import { SLIDER_DEFINITIONS, readSliderInventory } from "./sliderCatalog";
import { createNeutralAnalysis } from "./faceAnalysis";

import {
  EFM_RANGE,
  baselinesForRace,
  baselinesForTarget,
  createNeutralEfmSliders,
  generateEfmSliders,
  interpretLandmarksForPreview,
  measureFace,
  measurementBaselines,
  rankingKeys,
  RACE_TIE_MARGIN,
  normalizeStylizedAnalysis,
  projectLandmarksForDiagnostic,
  raceFoundationFor,
  recommendRaceFoundations,
  recommendShapeStyles,
  sliderRecord,
  type FaceLandmark
} from "./faceAnalysis";

/**
 * What this pipeline measured on the mean playable head: the average across all nine race morphs
 * and both sexes. This is the face a character actually starts from, so it is the one that must
 * export nothing. 0.19.0 used the un-morphed CharGen mesh here, which no player ever sees --
 * measuring the race heads in 0.20.0 showed it sits several percent off every real head.
 * Recorded from qa/race-calibration.json; regenerate with the baselines.
 */
/**
 * What the pipeline measured on each race's own head: the CharGen mesh with that race's morph
 * from <sex>HeadRaces.tri applied, averaged over both sexes. Recorded from
 * qa/race-calibration.json by qa/calibrate-races.mjs.
 */
const RACE_HEADS: Record<string, Record<string, number>> = {
  BretonRace: { cheekHeight: 0.4874, cheekWidth: 0.8651, chinShape: 0.2325, chinWidth: 0.1892, eyeInnerCorner: 0.0105, eyeInnerHeight: 0.0545, eyeOpenness: 0.3594, eyeOuterCorner: 0.0635, eyeOuterHeight: 0.3296, eyeSpacing: 0.2332, eyeVertical: 0.3112, eyeWidth: 0.1926, faceAspect: 1.0803, jawHeight: 0.7817, jawWidth: 0.8139, lipFullness: 0.1563, lowerFace: 0.4268, lowerLidCurve: 0.1148, lowerLip: 0.0597, mouthVertical: 0.7447, mouthWidth: 0.336, noseBridgeWidth: 0.0801, noseLength: 0.2805, noseRootHeight: 0.2927, noseTipWidth: 0.0798, noseVertical: 0.5321, noseWidth: 0.2249, noseWingHeight: 0.5652, philtrumWidth: 0.1044, upperLidCurve: 0.2544, upperLip: 0.0392 },
  DarkElfRace: { cheekHeight: 0.476, cheekWidth: 0.8756, chinShape: 0.2368, chinWidth: 0.1879, eyeInnerCorner: 0.011, eyeInnerHeight: 0.0558, eyeOuterCorner: 0.0663, eyeOuterHeight: 0.336, eyeSpacing: 0.2503, eyeVertical: 0.3038, eyeWidth: 0.1974, faceAspect: 1.1412, jawHeight: 0.7615, jawWidth: 0.7935, lipFullness: 0.1951, lowerFace: 0.4325, lowerLidCurve: 0.1253, noseBridgeWidth: 0.0827, noseLength: 0.2807, noseRootHeight: 0.2868, noseTipWidth: 0.0814, noseVertical: 0.5287, noseWidth: 0.2313, noseWingHeight: 0.5582, upperLidCurve: 0.2329 },
  HighElfRace: { cheekHeight: 0.4685, cheekWidth: 0.8678, chinShape: 0.2413, chinWidth: 0.1947, eyeInnerCorner: 0.0102, eyeInnerHeight: 0.0523, eyeOpenness: 0.373, eyeOuterCorner: 0.065, eyeOuterHeight: 0.333, eyeSpacing: 0.2368, eyeVertical: 0.2976, eyeWidth: 0.1952, faceAspect: 1.131, jawHeight: 0.7595, jawWidth: 0.807, lipFullness: 0.1931, lowerFace: 0.4441, lowerLidCurve: 0.1234, mouthVertical: 0.7418, mouthWidth: 0.3374, noseBridgeWidth: 0.0808, noseLength: 0.2778, noseRootHeight: 0.2781, noseTipWidth: 0.0813, noseVertical: 0.5171, noseWidth: 0.2303, noseWingHeight: 0.5466, philtrumWidth: 0.1075, upperLidCurve: 0.2586 },
  ImperialRace: { cheekHeight: 0.4896, cheekWidth: 0.8704, chinShape: 0.2301, chinWidth: 0.1877, eyeInnerCorner: 0.0103, eyeInnerHeight: 0.0533, eyeOpenness: 0.3605, eyeOuterCorner: 0.0642, eyeOuterHeight: 0.3332, eyeSpacing: 0.2359, eyeVertical: 0.3112, eyeWidth: 0.1926, faceAspect: 1.0838, jawHeight: 0.7846, jawWidth: 0.8153, lipFullness: 0.1529, lowerFace: 0.4212, lowerLidCurve: 0.1178, lowerLip: 0.0598, mouthVertical: 0.7462, mouthWidth: 0.3357, noseBridgeWidth: 0.0802, noseLength: 0.2845, noseRootHeight: 0.2944, noseTipWidth: 0.0797, noseVertical: 0.538, noseWidth: 0.2249, noseWingHeight: 0.5697, philtrumWidth: 0.1053, upperLidCurve: 0.2525, upperLip: 0.0385 },
  NordRace: { cheekHeight: 0.4901, cheekWidth: 0.8661, chinShape: 0.2311, chinWidth: 0.189, eyeInnerCorner: 0.0105, eyeInnerHeight: 0.0548, eyeOpenness: 0.3517, eyeOuterCorner: 0.0626, eyeOuterHeight: 0.3278, eyeSpacing: 0.2302, eyeVertical: 0.3125, eyeWidth: 0.1911, faceAspect: 1.0771, jawHeight: 0.7862, jawWidth: 0.8176, lipFullness: 0.1547, lowerFace: 0.4255, lowerLidCurve: 0.1153, lowerLip: 0.0619, mouthVertical: 0.7442, mouthWidth: 0.3408, noseBridgeWidth: 0.079, noseLength: 0.2812, noseRootHeight: 0.2933, noseTipWidth: 0.0784, noseVertical: 0.5321, noseWidth: 0.2229, noseWingHeight: 0.5673, philtrumWidth: 0.1042, upperLidCurve: 0.2475, upperLip: 0.0417 },
  OrcRace: { cheekHeight: 0.4748, cheekWidth: 0.8727, chinShape: 0.2358, chinWidth: 0.1973, eyeInnerCorner: 0.0108, eyeInnerHeight: 0.0561, eyeOpenness: 0.3688, eyeOuterCorner: 0.063, eyeOuterHeight: 0.3257, eyeSpacing: 0.2314, eyeVertical: 0.2969, eyeWidth: 0.1932, faceAspect: 1.0958, jawHeight: 0.7877, jawWidth: 0.8371, lipFullness: 0.1964, lowerLidCurve: 0.1123, noseBridgeWidth: 0.0792, noseLength: 0.2717, noseRootHeight: 0.2734, noseTipWidth: 0.0797, noseVertical: 0.502, noseWidth: 0.2286, noseWingHeight: 0.5393, philtrumWidth: 0.1217, upperLidCurve: 0.266 },
  RedguardRace: { cheekHeight: 0.4908, cheekWidth: 0.8683, chinShape: 0.2279, chinWidth: 0.1858, eyeInnerCorner: 0.01, eyeInnerHeight: 0.0517, eyeOpenness: 0.3504, eyeOuterCorner: 0.0653, eyeOuterHeight: 0.3369, eyeSpacing: 0.2347, eyeVertical: 0.3121, eyeWidth: 0.1937, faceAspect: 1.0604, jawHeight: 0.7887, jawWidth: 0.815, lipFullness: 0.1448, lowerFace: 0.4209, lowerLidCurve: 0.1165, lowerLip: 0.0587, mouthVertical: 0.7464, mouthWidth: 0.3287, noseBridgeWidth: 0.0791, noseLength: 0.286, noseRootHeight: 0.2931, noseTipWidth: 0.0779, noseVertical: 0.5357, noseWidth: 0.2196, noseWingHeight: 0.5703, philtrumWidth: 0.1017, upperLidCurve: 0.2423, upperLip: 0.0404 },
  WoodElfRace: { cheekHeight: 0.4718, cheekWidth: 0.8702, chinShape: 0.2398, chinWidth: 0.1917, eyeInnerCorner: 0.0109, eyeInnerHeight: 0.0551, eyeOpenness: 0.3675, eyeOuterCorner: 0.0651, eyeOuterHeight: 0.3304, eyeSpacing: 0.2437, eyeVertical: 0.2986, eyeWidth: 0.197, faceAspect: 1.1398, jawHeight: 0.7654, jawWidth: 0.7995, lipFullness: 0.2182, lowerFace: 0.4446, lowerLidCurve: 0.1147, noseBridgeWidth: 0.0812, noseLength: 0.277, noseRootHeight: 0.2784, noseTipWidth: 0.0813, noseVertical: 0.5165, noseWidth: 0.2327, noseWingHeight: 0.5485, philtrumWidth: 0.1136, upperLidCurve: 0.2617 }
};

const MEAN_PLAYABLE_HEAD: Record<string, number> = {
  eyeInnerCorner: 0.0105,
  eyeOuterCorner: 0.0644,
  upperLidCurve: 0.252,
  lowerLidCurve: 0.1175,
  eyeTilt: 0.0,
  irisSize: 0.0906,
  browThickness: 0.0804,
  lipFullness: 0.1764,
  lipGap: 0.0806,
  faceAspect: 1.1012,
  cheekWidth: 0.8695,
  cheekHeight: 0.4811,
  jawWidth: 0.8124,
  jawHeight: 0.7769,
  chinWidth: 0.1904,
  chinShape: 0.2344,
  lowerFace: 0.4318,
  eyeWidth: 0.1941,
  eyeSpacing: 0.237,
  eyeOpenness: 0.3623,
  eyeVertical: 0.3055,
  eyeInnerHeight: 0.0542,
  eyeOuterHeight: 0.3316,
  browHeight: 0.1075,
  browAngle: -5.3584,
  browWidth: 0.3013,
  noseWidth: 0.2269,
  noseBridgeWidth: 0.0803,
  noseTipWidth: 0.0799,
  noseLength: 0.2799,
  noseVertical: 0.5253,
  noseRootHeight: 0.2863,
  noseWingHeight: 0.5581,
  mouthWidth: 0.3373,
  mouthAngle: 0.0,
  philtrumWidth: 0.1087,
  upperLip: 0.0395,
  lowerLip: 0.0592,
  mouthVertical: 0.7413
};

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
  set(61, 0.39, 0.70);
  set(291, 0.61, 0.70);
  set(0, 0.5, 0.685);
  set(13, 0.5, 0.70);
  set(14, 0.5, 0.705);
  set(17, 0.5, 0.725);
  set(123, 0.25, 0.50);
  set(352, 0.75, 0.50);
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

const reframeForAspect = (
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): FaceLandmark[] =>
  landmarks.map((landmark) => ({
    ...landmark,
    x: 0.5 + (landmark.x - 0.5) / sourceAspectRatio
  }));

describe("face proportion mapping", () => {
  it("produces finite EFM values inside the RaceMenu slider range", () => {
    const analysis = measureFace(syntheticFace());
    const values = sliderRecord(generateEfmSliders(analysis));
    expect(Object.keys(values).length).toBeGreaterThan(15);
    expect(Object.keys(values).length).toBeGreaterThanOrEqual(35);
    for (const [name, value] of Object.entries(values)) {
      expect(name.startsWith("EFM_")).toBe(true);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-EFM_RANGE);
      expect(value).toBeLessThanOrEqual(EFM_RANGE);
    }
  });

  it("stays inside the hand-authored preset band instead of pinning sliders at the limit", () => {
    // Regression for the "over-exaggerated high elf" report: 0.6.0 emitted values up to 8.5 with
    // several sliders flat against its own clamp. Five installed preset mods sit at mean |value|
    // 0.48-1.11 with a 90th percentile of 1.4-2.3, so a face must land in that neighbourhood.
    const magnitudes = Object.values(
      sliderRecord(generateEfmSliders(measureFace(syntheticFace())))
    ).map(Math.abs);
    const mean = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;

    expect(mean).toBeGreaterThan(0.05);
    expect(mean).toBeLessThan(1.2);
    expect(Math.max(...magnitudes)).toBeLessThanOrEqual(EFM_RANGE);
    expect(magnitudes.filter((value) => value >= EFM_RANGE - 0.001)).toHaveLength(0);
  });

  it("keeps a strongly deviating measurement inside the range instead of clamping it flat", () => {
    // The synthetic mesh sits about 60% above the inner-eye-spacing baseline. 0.6.0 mapped that
    // well past its own limit and wrote a flat maximum; compression must keep it in band.
    const spacing = sliderRecord(generateEfmSliders(measureFace(syntheticFace())))[
      "EFM_Eyes_Width"
    ];
    expect(spacing).toBeGreaterThan(1);
    expect(spacing).toBeLessThan(EFM_RANGE);
  });

  it("reports a near-flat brow as a near-zero angle", () => {
    // Both brows in the synthetic mesh drop about 0.005 toward the outer end. Measuring the two
    // brows in opposite screen directions used to turn that into roughly 87 degrees of tilt.
    const analysis = measureFace(syntheticFace());
    expect(Math.abs(analysis.measurements.browAngle.value)).toBeLessThan(6);
    expect(
      Math.abs(sliderRecord(generateEfmSliders(analysis))["EFM_Brow_Angle"])
    ).toBeLessThan(1);
  });

  it("names non-neutral expressions and holds what they destroyed at neutral", () => {
    const analysis = measureFace(syntheticFace(), {
      jawOpen: 0.8,
      mouthSmileLeft: 0.7
    });
    const text = analysis.warnings.join(" ");
    expect(text).toMatch(/open mouth/i);
    expect(text).toMatch(/smile/i);
    expect(text).toMatch(/left at the neutral default/i);
    expect(analysis.trust.mouthWidth).toBeLessThan(0.05);
    expect(analysis.trust.mouthVertical).toBeLessThan(0.05);
  });

  it("rejects incomplete landmark data", () => {
    expect(() => measureFace([{ x: 0, y: 0 }])).toThrow(/at least 468/);
  });

  it("rejects an invalid source image aspect ratio", () => {
    expect(() => measureFace(syntheticFace(), {}, 0)).toThrow(/aspect ratio/);
  });

  it("keeps measurements invariant across portrait, square, and landscape crops", () => {
    const square = measureFace(syntheticFace(), {}, 1);
    const portraitAspect = 1067 / 1600;
    const landscapeAspect = 1920 / 1080;
    const portrait = measureFace(
      reframeForAspect(syntheticFace(), portraitAspect),
      {},
      portraitAspect
    );
    const landscape = measureFace(
      reframeForAspect(syntheticFace(), landscapeAspect),
      {},
      landscapeAspect
    );

    for (const key of Object.keys(square.measurements) as Array<
      keyof typeof square.measurements
    >) {
      expect(portrait.measurements[key].value).toBeCloseTo(
        square.measurements[key].value,
        10
      );
      expect(landscape.measurements[key].value).toBeCloseTo(
        square.measurements[key].value,
        10
      );
    }
    expect(portrait.rollDegrees).toBeCloseTo(square.rollDegrees, 10);
    expect(landscape.rollDegrees).toBeCloseTo(square.rollDegrees, 10);
    expect(portrait.yawOffset).toBeCloseTo(square.yawOffset, 10);
    expect(landscape.yawOffset).toBeCloseTo(square.yawOffset, 10);
    expect(portrait.symmetry).toBeCloseTo(square.symmetry, 10);
    expect(landscape.symmetry).toBeCloseTo(square.symmetry, 10);
  });

  it("projects identical diagnostic geometry from portrait and landscape coordinates", () => {
    const portraitAspect = 1067 / 1600;
    const landscapeAspect = 1920 / 1080;
    const portraitLandmarks = reframeForAspect(syntheticFace(), portraitAspect);
    const landscapeLandmarks = reframeForAspect(syntheticFace(), landscapeAspect);
    const portrait = projectLandmarksForDiagnostic(
      portraitLandmarks,
      measureFace(portraitLandmarks, {}, portraitAspect)
    );
    const landscape = projectLandmarksForDiagnostic(
      landscapeLandmarks,
      measureFace(landscapeLandmarks, {}, landscapeAspect)
    );

    for (const index of [10, 152, 234, 454, 33, 263, 98, 327, 61, 291]) {
      expect(portrait[index].x).toBeCloseTo(landscape[index].x, 8);
      expect(portrait[index].y).toBeCloseTo(landscape[index].y, 8);
    }
  });

  it("normalizes exaggerated illustration features toward believable baselines", () => {
    const exaggerated = syntheticFace();
    exaggerated[33] = { x: 0.27, y: 0.38 };
    exaggerated[133] = { x: 0.43, y: 0.4 };
    exaggerated[362] = { x: 0.57, y: 0.4 };
    exaggerated[263] = { x: 0.73, y: 0.38 };
    const raw = measureFace(exaggerated);
    const normalized = normalizeStylizedAnalysis(raw, 0.65);
    expect(
      Math.abs(normalized.measurements.eyeWidth.value - 0.18)
    ).toBeLessThan(Math.abs(raw.measurements.eyeWidth.value - 0.18));
    expect(normalized.warnings.join(" ")).toMatch(/Stylized source/);
  });

  it("corrects a Frieren-like tall illustrated oval and previews the interpreted geometry", () => {
    const stylized = syntheticFace();
    stylized[10] = { x: 0.5, y: 0.1 };
    stylized[152] = { x: 0.5, y: 0.9 };
    stylized[234] = { x: 0.276, y: 0.48 };
    stylized[454] = { x: 0.724, y: 0.48 };

    const raw = measureFace(stylized);
    const normalized = normalizeStylizedAnalysis(raw, 0.62);
    const preview = measureFace(
      interpretLandmarksForPreview(stylized, normalized),
      {},
      normalized.sourceAspectRatio
    );

    // Stated as the share of the gap to the neutral head that normalization closes, not as an
    // absolute band. The old band (1.42-1.46) was picked against a baseline of 1.34 that turned out
    // to be an estimate; when 0.19.0 measured the real head at 1.081 the same behaviour landed at
    // 1.218 and the band failed while nothing had regressed. The invariant is that a tall
    // illustrated oval is pulled most of the way toward the Skyrim head without being flattened
    // onto it.
    const closed =
      (raw.measurements.faceAspect.value - normalized.measurements.faceAspect.value) /
      (raw.measurements.faceAspect.value - measurementBaselines.faceAspect);
    expect(raw.measurements.faceAspect.value).toBeGreaterThan(1.78);
    expect(closed).toBeGreaterThanOrEqual(0.75);
    expect(closed).toBeLessThanOrEqual(0.9);
    expect(normalized.measurements.faceAspect.value).toBeGreaterThan(
      measurementBaselines.faceAspect
    );
    expect(preview.measurements.faceAspect.value).toBeCloseTo(
      normalized.measurements.faceAspect.value,
      3
    );
  });

  it("ranks three EFM-supported race foundations using geometry only", () => {
    const recommendations = recommendRaceFoundations(measureFace(syntheticFace()));
    expect(recommendations).toHaveLength(3);
    expect(recommendations.every((item) => item.score >= 1 && item.score <= 99)).toBe(true);
    expect(recommendations[0].basis).toMatch(/ethnicity are never analyzed/);
  });

  it("uses the chosen race's default head proportions as slider baselines", () => {
    // Each race starts from its own vanilla head. Without this, a High Elf and a Breton would
    // receive the same offsets from a universal average even though their starting meshes differ.
    const highElf = baselinesForRace("HighElfRace");
    const breton = baselinesForRace("BretonRace");
    const none = baselinesForRace(null);

    expect(none.faceAspect).toBe(measurementBaselines.faceAspect);
    expect(highElf.faceAspect).toBeGreaterThan(breton.faceAspect);
    expect(highElf.jawWidth).toBeLessThan(breton.jawWidth);
    // Measurements a race does not override stay on the universal baseline.
    expect(highElf.mouthWidth).toBe(measurementBaselines.mouthWidth);
    expect(raceFoundationFor("HighElfRaceVampire")?.race).toBe("High Elf");
    expect(raceFoundationFor("ArgonianRace")).toBeNull();

    const analysis = measureFace(syntheticFace());
    const generic = sliderRecord(generateEfmSliders(analysis, null, null));
    const elf = sliderRecord(generateEfmSliders(analysis, null, "HighElfRace"));
    const nord = sliderRecord(generateEfmSliders(analysis, null, "NordRace"));
    // Face-aspect and jaw-width sliders must move when the race baseline changes.
    expect(elf["EFM_Face_Height"]).not.toBe(generic["EFM_Face_Height"]);
    expect(nord["EFM_Jaw_Width"]).not.toBe(elf["EFM_Jaw_Width"]);
  });

  it("applies only a slight optional sex touch-up, off by default", () => {
    const plain = baselinesForTarget("NordRace", "male", false);
    const male = baselinesForTarget("NordRace", "male", true);
    const female = baselinesForTarget("NordRace", "female", true);
    // Off means identity with the race baseline.
    expect(plain.jawWidth).toBe(baselinesForRace("NordRace").jawWidth);
    // Male lowers the jaw baseline a little (more jaw in the export); female raises it (softer).
    expect(male.jawWidth).toBeLessThan(plain.jawWidth);
    expect(female.jawWidth).toBeGreaterThan(plain.jawWidth);
    // Keep it slight — nothing beyond a few percent.
    expect(plain.jawWidth / male.jawWidth).toBeLessThan(1.06);
    expect(female.jawWidth / plain.jawWidth).toBeLessThan(1.06);

    const analysis = measureFace(syntheticFace());
    const off = sliderRecord(generateEfmSliders(analysis, null, "NordRace", "male", false));
    const onMale = sliderRecord(generateEfmSliders(analysis, null, "NordRace", "male", true));
    const onFemale = sliderRecord(generateEfmSliders(analysis, null, "NordRace", "female", true));
    expect(onMale["EFM_Jaw_Width"]).toBeGreaterThan(off["EFM_Jaw_Width"]);
    expect(onFemale["EFM_Jaw_Width"]).toBeLessThan(off["EFM_Jaw_Width"]);
    // Eyes move the other way: male a touch smaller, female a touch larger.
    expect(onMale["EFM_Eyes_Size"]).toBeLessThan(off["EFM_Eyes_Size"]);
    expect(onFemale["EFM_Eyes_Size"]).toBeGreaterThan(off["EFM_Eyes_Size"]);
  });

  it("offers a geometry shape style without claiming real-world ethnicity", () => {
    // Compact soft midface cues: narrow cheeks/bridge, larger eyes — inspired by hand-authored
    // EFM presets such as YUYOU, not by classifying people.
    const points = syntheticFace();
    // Squeeze cheeks (234/454) and widen eyes slightly for a higher style score.
    points[234] = { x: 0.28, y: 0.48, z: 0 };
    points[454] = { x: 0.72, y: 0.48, z: 0 };
    points[33] = { x: 0.29, y: 0.39, z: 0 };
    points[133] = { x: 0.42, y: 0.39, z: 0 };
    points[362] = { x: 0.58, y: 0.39, z: 0 };
    points[263] = { x: 0.71, y: 0.39, z: 0 };
    const analysis = measureFace(points);
    const styles = recommendShapeStyles(analysis);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles[0].id).toBe("compactSoftMidface");
    expect(styles[0].basis.toLowerCase()).toMatch(/ethnicity/);
    expect(styles[0].preferredRaces).toContain("Breton");

    const plain = baselinesForTarget("BretonRace", "female", false, "none");
    const styled = baselinesForTarget("BretonRace", "female", false, "compactSoftMidface");
    expect(styled.cheekWidth).toBeLessThan(plain.cheekWidth);
    expect(styled.noseBridgeWidth).toBeLessThan(plain.noseBridgeWidth);
    expect(styled.eyeWidth).toBeLessThan(plain.eyeWidth);

    const off = sliderRecord(
      generateEfmSliders(analysis, null, "BretonRace", "female", false, "none")
    );
    const on = sliderRecord(
      generateEfmSliders(analysis, null, "BretonRace", "female", false, "compactSoftMidface")
    );
    // Narrower cheek baseline → higher cheek-width slider magnitude toward narrower face.
    expect(on["EFM_Cheek_Width"]).not.toBe(off["EFM_Cheek_Width"]);
  });

  it("creates the full neutral EFM set for vision-only illustration fallback", () => {
    const names = Object.keys(sliderRecord(createNeutralEfmSliders()));
    expect(names).toHaveLength(63);
    expect(names.every((name) => name.startsWith("EFM_"))).toBe(true);
  });

  it("writes only EFM until an install inventory says otherwise", () => {
    // Writing a CME key that the user's RaceMenu does not define would leave a dead entry in the
    // preset, so the other families stay off until a preset proves they exist.
    const names = Object.keys(
      sliderRecord(generateEfmSliders(measureFace(syntheticFace())))
    );
    expect(names.some((name) => name.startsWith("CME_"))).toBe(false);
  });

  it("adds the other families once an inventory declares them, at their own range", () => {
    const inventory = readSliderInventory(
      {
        morphs: {
          custom: [
            { name: "EFM_Nose_Width", value: 0 },
            { name: "CME_NoseLength", value: 0 },
            { name: "NSK_MouthWidth", value: 0 },
            { name: "CME_NoseType", value: 12 }
          ]
        }
      },
      "inventory.jslot"
    );
    expect(inventory.names.size).toBe(4);

    const groups = generateEfmSliders(measureFace(syntheticFace()), inventory);
    const sliders = groups.flatMap((group) => group.sliders);
    const names = sliders.map((entry) => entry.name);

    expect(names).toContain("CME_NoseLength");
    expect(names).toContain("NSK_MouthWidth");
    // An integer type selector picks a numbered shape; it is never written as a morph value.
    expect(names).not.toContain("CME_NoseType");
    // EFM sliders the inventory did not list are dropped too.
    expect(names).not.toContain("EFM_Jaw_Width");

    expect(sliders.find((entry) => entry.name === "EFM_Nose_Width")?.range).toBe(3);
    expect(sliders.find((entry) => entry.name === "CME_NoseLength")?.range).toBe(1);
    for (const entry of sliders) {
      expect(Math.abs(entry.value)).toBeLessThanOrEqual(entry.range);
    }
  });

  /**
   * The invariant every automatic path must hold: a face whose measurements already equal the
   * reference head has no deviation to encode, so it must export zeros. FaceForge 0.16.0-0.17.0
   * violated this on the High Poly Head path -- 27 non-zero sliders peaking at 0.55 on a
   * perfectly neutral face -- because baseline multipliers were being used as a strength knob.
   * Every real face carried that bias on top of its actual deviation.
   */
  it("exports nothing for a face that already matches the reference head", () => {
    const neutral = createNeutralAnalysis();
    for (const highPolyHead of [false, true]) {
      const values = Object.entries(
        sliderRecord(generateEfmSliders(neutral, null, null, null, false, "none", highPolyHead))
      );
      expect(values.length).toBeGreaterThan(0);
      for (const [name, value] of values) {
        expect(
          Math.abs(value),
          `${name} should be 0 on a neutral face (highPolyHead=${highPolyHead})`
        ).toBeLessThan(0.005);
      }
    }
  });

  /**
   * The invariant above passes on any baseline table, right or wrong, because
   * createNeutralAnalysis builds its face out of the baselines themselves. This one uses the real
   * thing: what the detector measured on the average of the nine race heads, both sexes, recovered
   * from qa/race-calibration.json. That IS the head a character starts from, so it must export
   * near-nothing -- and against the estimated baselines shipped through 0.18.0 it did not. It
   * exported 107 non-zero sliders, mean 0.99, with sliders pinned at the +3 limit.
   *
   * Only sliders driven by a calibrated measurement are asserted. Brows and iris are textures in
   * Skyrim, not geometry, so their baselines are still estimates and a render cannot judge them.
   */
  it("exports near-nothing for the mean playable head the baselines are measured from", () => {
    const estimated = new Set([
      "browHeight",
      "browAngle",
      "browWidth",
      "browThickness",
      "irisSize",
      "lipGap"
    ]);
    const analysis = createNeutralAnalysis();
    for (const [key, value] of Object.entries(MEAN_PLAYABLE_HEAD)) {
      analysis.measurements[key as keyof typeof analysis.measurements].value = value;
    }

    const sliders = generateEfmSliders(analysis).flatMap((group) => group.sliders);
    const sourceOf = new Map(SLIDER_DEFINITIONS.map((item) => [item.name, item.source]));
    const calibrated = sliders.filter((slider) => !estimated.has(sourceOf.get(slider.name)!));

    expect(calibrated.length).toBe(55);
    for (const slider of calibrated) {
      expect(Math.abs(slider.value), `${slider.name} on the neutral head`).toBeLessThan(0.8);
    }
    const mean =
      calibrated.reduce((total, slider) => total + Math.abs(slider.value), 0) / calibrated.length;
    expect(mean).toBeLessThan(0.2);
  });

  /**
   * Reported from a real run: a young woman's photo ranked Redguard joint-top at 88%. The cause was
   * not the app inferring anything about the person -- it never looks at skin or ancestry -- but
   * that each race was averaged over its OWN four or five proportions and those averages were then
   * sorted against each other. Redguard is the only race estimating cheekWidth beside noseWidth, so
   * it was scored on a dimension no rival was tested on.
   */
  it("ranks every race over the same measurements", () => {
    const analysis = measureFace(syntheticFace());
    const ranked = recommendRaceFoundations(analysis);

    // Whatever the ranking measures, it must be defined for every candidate -- otherwise the
    // averages being sorted against each other are averages over different things.
    for (const key of rankingKeys) {
      for (const entry of ranked) {
        expect(baselinesForRace(entry.editorId)[key]).toBeGreaterThan(0);
      }
    }
    expect(rankingKeys.length).toBeGreaterThan(20);
    expect(ranked.every((entry) => entry.basis.includes("every race estimates"))).toBe(true);

    // And a near-tie must say so rather than implying an order.
    const spread = ranked[ranked.length - 1].correctionEffort - ranked[0].correctionEffort;
    const flagged = ranked.filter((entry) =>
      entry.reasons.some((reason) => reason.includes("measures the same"))
    ).length;
    expect(flagged).toBe(
      ranked.filter(
        (entry) => entry.correctionEffort - ranked[0].correctionEffort < RACE_TIE_MARGIN
      ).length
    );
    expect(spread).toBeGreaterThanOrEqual(0);
  });

  /**
   * The check the fabricated race table could never pass. Each race's own head is fed back in; the
   * ranking must name that race. Until 0.20.0 the table held prose-derived guesses -- Redguard was
   * given a "moderately broad nose foundation" at +8% when the real morph is 3% narrower -- so the
   * ranking could not identify even a perfect match, and it put Redguard on top of faces that look
   * nothing like a Redguard head.
   *
   * Top three, not top one, because the nine real morphs sit within about 5% of one another. That
   * closeness is the honest finding, and it is why near-ties are labelled rather than ordered.
   */
  it("identifies each race from its own head", () => {
    const missed: string[] = [];
    for (const [editorId, head] of Object.entries(RACE_HEADS)) {
      const analysis = createNeutralAnalysis();
      for (const [key, value] of Object.entries(head)) {
        analysis.measurements[key as keyof typeof analysis.measurements].value = value;
      }
      const ranked = recommendRaceFoundations(analysis);
      if (!ranked.some((entry) => entry.editorId === editorId)) {
        missed.push(`${editorId} -> ${ranked.map((entry) => entry.editorId).join(", ")}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it("keeps High Poly Head on the same response as a vanilla head", () => {
    // Until the HPH CharGen mesh is actually measured there is no evidence it needs a different
    // response, and guessing one silently rescaled every export for anyone with HPH installed.
    const analysis = measureFace(syntheticFace());
    const vanilla = sliderRecord(
      generateEfmSliders(analysis, null, null, null, false, "none", false)
    );
    const hph = sliderRecord(
      generateEfmSliders(analysis, null, null, null, false, "none", true)
    );
    for (const [name, value] of Object.entries(vanilla)) {
      expect(hph[name], `${name} should not depend on head mesh`).toBeCloseTo(value, 6);
    }
  });

  it("still shifts values when the chosen race's head genuinely differs", () => {
    // The race baseline is a real claim about the reference head, so unlike the withdrawn HPH
    // factors it is *supposed* to move a neutral face: that face really is longer or wider than
    // the race it is being fitted to.
    const neutral = createNeutralAnalysis();
    const generic = sliderRecord(generateEfmSliders(neutral));
    const breton = sliderRecord(
      generateEfmSliders(neutral, null, "BretonRace", null, false, "none", false)
    );
    expect(generic["EFM_Face_Height"]).toBeCloseTo(0, 6);
    expect(Math.abs(breton["EFM_Face_Height"])).toBeGreaterThan(0.05);
  });
});
