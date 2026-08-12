import { describe, expect, it } from "vitest";
import {
  createNeutralAnalysis,
  MEASUREMENT_KEYS,
  type FaceAnalysis,
  type FaceLandmark
} from "./faceAnalysis";
import {
  fuseFaceAnalyses,
  selectVideoViews,
  signedYawOffset,
  type AnalyzedView,
  type ViewRole
} from "./multiView";

const landmarks = (noseX = 0.5): FaceLandmark[] => {
  const values = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  values[1] = { x: noseX, y: 0.5 };
  values[234] = { x: 0.25, y: 0.5 };
  values[454] = { x: 0.75, y: 0.5 };
  return values;
};

const analysis = (vertical = 0.5, width = 0.9): FaceAnalysis => ({
  ...createNeutralAnalysis(),
  measurements: Object.fromEntries(MEASUREMENT_KEYS.map((key) => [
    key,
    {
      key,
      label: key,
      value: key === "cheekWidth" ? width : vertical,
      display: (key === "cheekWidth" ? width : vertical).toFixed(3)
    }
  ])) as FaceAnalysis["measurements"],
  symmetry: 90
});

const view = (
  role: ViewRole,
  value: FaceAnalysis,
  used = true,
  score = 0.8
): AnalyzedView => ({
  role,
  analysis: value,
  report: {
    role,
    detectedRole: role,
    yaw: role === "left" ? -0.08 : role === "right" ? 0.08 : 0,
    quality: {
      score,
      brightness: 0.5,
      contrast: 0.2,
      sharpness: 0.1,
      faceCoverage: 0.2,
      warnings: []
    },
    score,
    used,
    warnings: []
  }
});

describe("multi-view analysis", () => {
  it("keeps width-sensitive measurements owned by the front view", () => {
    const result = fuseFaceAnalyses([
      view("front", analysis(0.5, 0.9)),
      view("left", analysis(0.54, 0.5)),
      view("right", analysis(0.54, 1.3))
    ]);
    expect(result.analysis.measurements.cheekWidth.value).toBe(0.9);
    expect(result.analysis.measurements.cheekHeight.value).toBeGreaterThan(0.5);
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  it("rejects a contradictory angled measurement instead of distorting output", () => {
    const result = fuseFaceAnalyses([
      view("front", analysis(0.5)),
      view("left", analysis(0.8))
    ]);
    expect(result.analysis.measurements.cheekHeight.value).toBe(0.5);
  });

  it("measures signed yaw and selects useful video frames", () => {
    expect(signedYawOffset(landmarks(0.46), 1)).toBeLessThan(0);
    const selected = selectVideoViews([
      { value: "left", yaw: -0.08, quality: 0.8 },
      { value: "front", yaw: 0.005, quality: 0.75 },
      { value: "right", yaw: 0.09, quality: 0.85 },
      { value: "profile", yaw: 0.3, quality: 1 }
    ]);
    expect(selected.front?.value).toBe("front");
    expect(selected.left?.value).toBe("left");
    expect(selected.right?.value).toBe("right");
  });
});
