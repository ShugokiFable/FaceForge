import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_KEYS,
  generateEfmSliders,
  measureFace,
  measurementBaselines,
  sliderRecord,
  type FaceLandmark
} from "./faceAnalysis";
import {
  correctSourceLandmarks,
  estimatePose,
  measurementTrust
} from "./sourceCorrection";

/** A symmetric, front-facing, neutral mesh. Every other fixture is a distortion of this one. */
const neutralFace = (): FaceLandmark[] => {
  const points: FaceLandmark[] = Array.from({ length: 478 }, (_, index) => ({
    // Spread the unused points along the midline instead of stacking them, so mirror pairing is
    // exercised on distinct coordinates rather than on hundreds of identical duplicates.
    x: 0.5,
    y: 0.02 + (index % 400) * 0.002,
    z: 0
  }));
  const set = (index: number, x: number, y: number, z = 0) => {
    points[index] = { x, y, z };
  };

  set(10, 0.5, 0.12);
  set(152, 0.5, 0.88);
  set(234, 0.22, 0.48, 0.06);
  set(454, 0.78, 0.48, 0.06);
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
  set(1, 0.5, 0.57, -0.05);
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

const rotate = (landmarks: readonly FaceLandmark[], degrees: number): FaceLandmark[] => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return landmarks.map((point) => ({
    x: 0.5 + (point.x - 0.5) * cos - (point.y - 0.5) * sin,
    y: 0.5 + (point.x - 0.5) * sin + (point.y - 0.5) * cos,
    z: point.z
  }));
};

/** Weak-perspective yaw: horizontal extents shrink by cos, and depth leaks into x. */
const yaw = (landmarks: readonly FaceLandmark[], degrees: number): FaceLandmark[] => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return landmarks.map((point) => {
    const dx = point.x - 0.5;
    const dz = point.z ?? 0;
    return {
      x: 0.5 + dx * cos + dz * sin,
      y: point.y,
      z: dz * cos - dx * sin
    };
  });
};

const measurementsOf = (landmarks: readonly FaceLandmark[]) =>
  measureFace(landmarks, {}, 1).measurements;

describe("source correction", () => {
  it("recovers a tilted head so measurements match the untilted original", () => {
    const straight = measurementsOf(neutralFace());
    const tilted = measurementsOf(rotate(neutralFace(), 14));

    for (const key of MEASUREMENT_KEYS) {
      expect(tilted[key].value).toBeCloseTo(straight[key].value, 2);
    }
  });

  it("reports the tilt it removed rather than hiding it", () => {
    const analysis = measureFace(rotate(neutralFace(), 14), {}, 1);
    expect(analysis.correction.pose.rollDegrees).toBeCloseTo(14, 0);
    expect(analysis.warnings.join(" ")).toMatch(/tilt of 14/i);
  });

  it("un-foreshortens a turned head back toward its front-facing widths", () => {
    const front = measurementsOf(neutralFace());
    const turned = yaw(neutralFace(), 18);
    const uncorrectedWidth =
      Math.abs(turned[454].x - turned[234].x) / Math.abs(turned[152].y - turned[10].y);
    const corrected = measurementsOf(turned);

    // The raw projection lost real width; the correction has to put most of it back.
    expect(uncorrectedWidth).toBeLessThan(0.56 / 0.76);
    expect(corrected.jawWidth.value).toBeCloseTo(front.jawWidth.value, 1);
    expect(corrected.faceAspect.value).toBeCloseTo(front.faceAspect.value, 1);
  });

  it("detects the direction and size of a turn", () => {
    const pose = estimatePose(yaw(neutralFace(), 18), 1);
    expect(pose.yawDegrees).toBeGreaterThan(10);
    expect(estimatePose(yaw(neutralFace(), -18), 1).yawDegrees).toBeLessThan(-10);
  });

  it("mirror-averages a lopsided face instead of trusting one side", () => {
    const lopsided = neutralFace();
    // Drag one side of the mouth and jaw out and down.
    lopsided[291] = { x: 0.68, y: 0.73, z: 0 };
    lopsided[397] = { x: 0.79, y: 0.72, z: 0 };
    const { landmarks: corrected, correction } = correctSourceLandmarks(lopsided, 1);

    expect(correction.asymmetryBefore).toBeGreaterThan(1);
    expect(correction.asymmetryAfter).toBeLessThan(0.001);
    for (const [left, right] of [
      [61, 291],
      [172, 397]
    ] as const) {
      expect(corrected[left].y).toBeCloseTo(corrected[right].y, 9);
      expect(Math.abs(corrected[left].x - 0.5)).toBeCloseTo(
        Math.abs(corrected[right].x - 0.5),
        9
      );
    }
  });

  it("reports an asymmetric brow as the average tilt, not the worse side", () => {
    const lopsided = neutralFace();
    // Raise only the left brow tail; the right brow keeps its neutral, near-flat slope.
    lopsided[70] = { x: 0.31, y: 0.29, z: 0 };
    const analysis = measureFace(lopsided, {}, 1);
    const oneSided = Math.atan2(0.325 - 0.29, 0.41 - 0.31) * (180 / Math.PI);

    expect(Math.abs(analysis.measurements.browAngle.value)).toBeGreaterThan(0.5);
    expect(Math.abs(analysis.measurements.browAngle.value)).toBeLessThan(
      Math.abs(oneSided)
    );
  });


  it("stops correcting past the recoverable angle and reports the lost confidence", () => {
    const { correction } = correctSourceLandmarks(yaw(neutralFace(), 48), 1);
    expect(correction.widthConfidence).toBeLessThan(0.7);
    expect(correction.notes.join(" ")).toMatch(/cannot be undone/i);
  });

  it("holds mouth measurements at neutral when the mouth is open", () => {
    const neutral = measureFace(neutralFace(), {}, 1);
    const smiling = measureFace(neutralFace(), { jawOpen: 0.7 }, 1);

    expect(smiling.trust.mouthVertical).toBeLessThan(0.05);
    // Against the baseline itself, not a copy of its value: "held at neutral" has to stay true
    // when the baselines are recalibrated, which is exactly what 0.19.0 did.
    expect(smiling.measurements.mouthVertical.value).toBeCloseTo(
      measurementBaselines.mouthVertical,
      2
    );
    // Features the expression does not touch keep their measured value.
    expect(smiling.measurements.eyeSpacing.value).toBeCloseTo(
      neutral.measurements.eyeSpacing.value,
      6
    );
  });

  it("holds eye shape at neutral when the eyes are closed", () => {
    const blinking = measureFace(neutralFace(), { eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8 }, 1);
    expect(blinking.trust.eyeOpenness).toBeLessThan(0.05);
    expect(blinking.measurements.eyeOpenness.value).toBeCloseTo(
      measurementBaselines.eyeOpenness,
      2
    );
    expect(blinking.warnings.join(" ")).toMatch(/closed or narrowed eyes/i);
  });

  it("fades a mild expression partially instead of discarding it", () => {
    const mild = measureFace(neutralFace(), { mouthSmileLeft: 0.3, mouthSmileRight: 0.3 }, 1);
    expect(mild.trust.mouthWidth).toBeGreaterThan(0.4);
    expect(mild.trust.mouthWidth).toBeLessThan(0.9);
  });

  it("marks the affected sliders so a held value is visible instead of silent", () => {
    const groups = generateEfmSliders(measureFace(neutralFace(), { jawOpen: 0.7 }, 1));
    const sliders = groups.flatMap((group) => group.sliders);
    expect(sliders.find((entry) => entry.name === "EFM_Lip_Height")?.confidence).toBeLessThan(
      0.05
    );
    expect(sliders.find((entry) => entry.name === "EFM_Eyes_Width")?.confidence).toBe(1);
    // A held slider must contribute nothing, not a wrong number.
    expect(sliderRecord(groups)["EFM_Lip_Height"]).toBeCloseTo(0, 2);
  });

  it("defaults the pre-detection straightening to none", () => {
    // Only the caller that actually rotated the image sets this; measureFace never invents it.
    expect(measureFace(rotate(neutralFace(), 14), {}, 1).correction.straightenedDegrees).toBe(0);
  });

  it("leaves a clean front-facing neutral source completely untouched", () => {
    const analysis = measureFace(neutralFace(), {}, 1);
    expect(Math.abs(analysis.correction.pose.rollDegrees)).toBeLessThan(0.5);
    expect(analysis.correction.widthConfidence).toBe(1);
    expect(analysis.correction.heightConfidence).toBe(1);
    expect(MEASUREMENT_KEYS.every((key) => analysis.trust[key] === 1)).toBe(true);
    expect(analysis.warnings).toEqual([
      "Front-facing and neutral; no pose or expression correction was needed."
    ]);
  });

  it("compounds pose residual with expression contamination", () => {
    const { confidence } = measurementTrust(
      { mouthSmileLeft: 0.45 },
      { widthConfidence: 0.5, heightConfidence: 1 },
      MEASUREMENT_KEYS
    );
    expect(confidence.mouthWidth).toBeLessThan(0.5 * 0.9);
    expect(confidence.noseLength).toBe(1);
  });
});

/**
 * A fringe is not an expression. The landmark model returns brow points for a brow it cannot see
 * and reports normal confidence, which on the export that prompted this produced brow readings
 * 70-168% away from their reference and pinned three sliders at their limit.
 */
describe("forehead occlusion", () => {
  const fullCover = { forehead: 0.95 };

  it("takes the brow axes to neutral when the forehead is covered", () => {
    const { confidence } = measurementTrust(
      {},
      { widthConfidence: 1, heightConfidence: 1 },
      ["browHeight", "browWidth", "browThickness", "browAngle", "jawWidth"],
      fullCover
    );
    for (const key of ["browHeight", "browWidth", "browThickness", "browAngle"] as const) {
      expect(confidence[key]).toBeLessThan(0.1);
    }
  });

  it("leaves every measurement the forehead does not cover alone", () => {
    const { confidence } = measurementTrust(
      {},
      { widthConfidence: 1, heightConfidence: 1 },
      ["jawWidth", "noseWidth", "mouthWidth"],
      fullCover
    );
    expect(confidence.jawWidth).toBe(1);
    expect(confidence.noseWidth).toBe(1);
    expect(confidence.mouthWidth).toBe(1);
  });

  it("says so, rather than silently dropping the brows", () => {
    const { reasons } = measurementTrust(
      {},
      { widthConfidence: 1, heightConfidence: 1 },
      ["browHeight"],
      fullCover
    );
    expect(reasons.join(" ")).toContain("hair over the forehead");
  });

  it("ignores a reading too weak to act on", () => {
    const { confidence, reasons } = measurementTrust(
      {},
      { widthConfidence: 1, heightConfidence: 1 },
      ["browHeight"],
      { forehead: 0.1 }
    );
    expect(confidence.browHeight).toBe(1);
    expect(reasons).toEqual([]);
  });

  it("behaves exactly as before when there is no reading", () => {
    const withNull = measurementTrust({}, { widthConfidence: 1, heightConfidence: 1 }, ["browHeight"], null);
    expect(withNull.confidence.browHeight).toBe(1);
  });
});
