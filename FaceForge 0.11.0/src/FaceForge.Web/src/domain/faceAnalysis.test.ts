import { describe, expect, it } from "vitest";
import { readSliderInventory } from "./sliderCatalog";
import {
  EFM_RANGE,
  createNeutralEfmSliders,
  generateEfmSliders,
  interpretLandmarksForPreview,
  measureFace,
  normalizeStylizedAnalysis,
  projectLandmarksForDiagnostic,
  recommendRaceFoundations,
  sliderRecord,
  type FaceLandmark
} from "./faceAnalysis";

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

    expect(raw.measurements.faceAspect.value).toBeGreaterThan(1.78);
    expect(normalized.measurements.faceAspect.value).toBeGreaterThanOrEqual(1.42);
    expect(normalized.measurements.faceAspect.value).toBeLessThanOrEqual(1.46);
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
});
