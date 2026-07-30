import {
  correctSourceLandmarks,
  estimatePose,
  measurementTrust,
  type AppliedCorrection
} from "./sourceCorrection";
import {
  FAMILY_RANGE,
  familyOf,
  selectDefinitions,
  type SliderInventory
} from "./sliderCatalog";

export interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface Measurement {
  key: MeasurementKey;
  label: string;
  value: number;
  display: string;
}

export type MeasurementKey =
  | "faceAspect"
  | "cheekWidth"
  | "cheekHeight"
  | "jawWidth"
  | "jawHeight"
  | "chinWidth"
  | "chinShape"
  | "lowerFace"
  | "eyeWidth"
  | "eyeSpacing"
  | "eyeOpenness"
  | "eyeVertical"
  | "eyeInnerHeight"
  | "eyeOuterHeight"
  | "browHeight"
  | "browAngle"
  | "browWidth"
  | "noseWidth"
  | "noseBridgeWidth"
  | "noseTipWidth"
  | "noseLength"
  | "noseVertical"
  | "noseRootHeight"
  | "noseWingHeight"
  | "mouthWidth"
  | "mouthAngle"
  | "philtrumWidth"
  | "upperLip"
  | "lowerLip"
  | "mouthVertical"
  | "eyeInnerCorner"
  | "eyeOuterCorner"
  | "upperLidCurve"
  | "lowerLidCurve"
  | "eyeTilt"
  | "irisSize"
  | "browThickness"
  | "lipFullness"
  | "lipGap";

export interface FaceAnalysis {
  measurements: Record<MeasurementKey, Measurement>;
  sourceAspectRatio: number;
  symmetry: number;
  rollDegrees: number;
  yawOffset: number;
  warnings: string[];
  /** What was geometrically undone before measuring, and how far it could be undone. */
  correction: AppliedCorrection;
  /** Per-measurement trust after pose residual and expression contamination, 0-1. */
  trust: Record<MeasurementKey, number>;
  /** The de-rolled, un-foreshortened, mirror-averaged mesh the measurements came from. */
  correctedLandmarks: FaceLandmark[];
}

/**
 * Emitted when the corrected mesh needed nothing at all. Callers that straightened or reframed
 * the image before detection must drop this line, or it contradicts what they did.
 */
export const NO_CORRECTION_NEEDED =
  "Front-facing and neutral; no pose or expression correction was needed.";

export const MEASUREMENT_KEYS: MeasurementKey[] = [
  "faceAspect",
  "cheekWidth",
  "cheekHeight",
  "jawWidth",
  "jawHeight",
  "chinWidth",
  "chinShape",
  "lowerFace",
  "eyeWidth",
  "eyeSpacing",
  "eyeOpenness",
  "eyeVertical",
  "eyeInnerHeight",
  "eyeOuterHeight",
  "browHeight",
  "browAngle",
  "browWidth",
  "noseWidth",
  "noseBridgeWidth",
  "noseTipWidth",
  "noseLength",
  "noseVertical",
  "noseRootHeight",
  "noseWingHeight",
  "mouthWidth",
  "mouthAngle",
  "philtrumWidth",
  "upperLip",
  "lowerLip",
  "mouthVertical",
  "eyeInnerCorner",
  "eyeOuterCorner",
  "upperLidCurve",
  "lowerLidCurve",
  "eyeTilt",
  "irisSize",
  "browThickness",
  "lipFullness",
  "lipGap"
];

export interface RaceRecommendation {
  race: string;
  score: number;
  reasons: string[];
  basis: string;
}

export interface FeatureTarget {
  category: "brows" | "eyes";
  label: string;
  description: string;
}

export interface GeneratedSlider {
  name: string;
  label: string;
  value: number;
  source: string;
  /** Trust in the measurement behind this slider, 0-1. Below 1 it has been faded to neutral. */
  confidence: number;
  /** The slider family's own limit: 3 for EFM, 1 for CME/NSK/SPG/RANs. */
  range: number;
}

export interface SliderGroup {
  id: "face" | "eyes" | "nose" | "mouth";
  title: string;
  sliders: GeneratedSlider[];
}

const point = (landmarks: readonly FaceLandmark[], index: number): FaceLandmark => {
  const value = landmarks[index];
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`Face landmark ${index} is missing or invalid.`);
  }
  return value;
};

const distance = (
  a: FaceLandmark,
  b: FaceLandmark,
  sourceAspectRatio: number
): number => Math.hypot((a.x - b.x) * sourceAspectRatio, a.y - b.y);

const midpoint = (a: FaceLandmark, b: FaceLandmark): FaceLandmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2
});

const ratio = (numerator: number, denominator: number, label: string): number => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(`Unable to measure ${label} from this image.`);
  }
  return numerator / denominator;
};

const measured = (key: MeasurementKey, label: string, value: number): Measurement => ({
  key,
  label,
  value,
  display: value.toFixed(3)
});

export function measureFace(
  sourceLandmarks: readonly FaceLandmark[],
  blendshapes: Readonly<Record<string, number>> = {},
  sourceAspectRatio = 1
): FaceAnalysis {
  if (sourceLandmarks.length < 468) {
    throw new Error(`Expected at least 468 face landmarks, received ${sourceLandmarks.length}.`);
  }
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) {
    throw new Error("Expected a positive finite source image aspect ratio.");
  }

  // Pose is read from the untouched mesh so the reported numbers describe the photograph, then
  // every proportion below is measured from the corrected mesh instead of the raw one.
  const pose = estimatePose(sourceLandmarks, sourceAspectRatio);
  const { landmarks: correctedLandmarks, correction } = correctSourceLandmarks(
    sourceLandmarks,
    sourceAspectRatio
  );
  const landmarks = correctedLandmarks;

  const top = point(landmarks, 10);
  const chin = point(landmarks, 152);
  const leftEdge = point(landmarks, 234);
  const rightEdge = point(landmarks, 454);
  const faceWidth = distance(leftEdge, rightEdge, sourceAspectRatio);
  const faceHeight = distance(top, chin, sourceAspectRatio);

  const leftEyeOuter = point(landmarks, 33);
  const leftEyeInner = point(landmarks, 133);
  const rightEyeInner = point(landmarks, 362);
  const rightEyeOuter = point(landmarks, 263);
  const leftEyeCenter = midpoint(leftEyeOuter, leftEyeInner);
  const rightEyeCenter = midpoint(rightEyeInner, rightEyeOuter);
  const eyeWidth =
    (distance(leftEyeOuter, leftEyeInner, sourceAspectRatio) +
      distance(rightEyeInner, rightEyeOuter, sourceAspectRatio)) /
    2;
  const eyeOpen =
    (distance(point(landmarks, 159), point(landmarks, 145), sourceAspectRatio) +
      distance(point(landmarks, 386), point(landmarks, 374), sourceAspectRatio)) /
    2;

  const browLeft = midpoint(point(landmarks, 70), point(landmarks, 107));
  const browRight = midpoint(point(landmarks, 336), point(landmarks, 300));
  const browHeight =
    (distance(browLeft, leftEyeCenter, sourceAspectRatio) +
      distance(browRight, rightEyeCenter, sourceAspectRatio)) /
    2;
  // Both brows must be measured in the same screen direction (outer -> inner on the left,
  // inner -> outer on the right). Sweeping the right brow the other way makes atan2 return an
  // angle near +/-180 degrees, and the left-minus-right difference below then reports roughly
  // 90 degrees of tilt for a flat brow -- which pinned EFM_Brow_Angle at its maximum on every
  // exported preset.
  const leftBrowAngle = Math.atan2(
    point(landmarks, 107).y - point(landmarks, 70).y,
    (point(landmarks, 107).x - point(landmarks, 70).x) * sourceAspectRatio
  );
  const rightBrowAngle = Math.atan2(
    point(landmarks, 300).y - point(landmarks, 336).y,
    (point(landmarks, 300).x - point(landmarks, 336).x) * sourceAspectRatio
  );

  // The landmark model refines the irises as points 468-477 when it returns 478 landmarks. That
  // is a real measurement of iris diameter rather than an inference from eye opening, but a mesh
  // without refinement has to fall back to the baseline so nothing is invented.
  const irisSize = (() => {
    if (landmarks.length < 478) return 0.115;
    const span = (center: number, edge: number) =>
      distance(point(landmarks, center), point(landmarks, edge), sourceAspectRatio) * 2;
    const diameter = (span(468, 469) + span(473, 474)) / 2;
    const value = diameter / faceWidth;
    return Number.isFinite(value) && value > 0.02 && value < 0.35 ? value : 0.115;
  })();

  const noseRoot = point(landmarks, 168);
  const noseBase = point(landmarks, 2);
  const noseTip = point(landmarks, 1);
  const mouthCenter = midpoint(point(landmarks, 13), point(landmarks, 14));
  const eyeLine = midpoint(leftEyeCenter, rightEyeCenter);

  const values: Record<MeasurementKey, Measurement> = {
    faceAspect: measured("faceAspect", "Face height / width", ratio(faceHeight, faceWidth, "face aspect")),
    cheekWidth: measured(
      "cheekWidth",
      "Cheek width",
      ratio(
        distance(point(landmarks, 123), point(landmarks, 352), sourceAspectRatio),
        faceWidth,
        "cheek width"
      )
    ),
    cheekHeight: measured(
      "cheekHeight",
      "Cheek vertical position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 123), point(landmarks, 352)),
          sourceAspectRatio
        ),
        faceHeight,
        "cheek height"
      )
    ),
    jawWidth: measured(
      "jawWidth",
      "Jaw width",
      ratio(
        distance(point(landmarks, 172), point(landmarks, 397), sourceAspectRatio),
        faceWidth,
        "jaw width"
      )
    ),
    jawHeight: measured(
      "jawHeight",
      "Jaw vertical position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 172), point(landmarks, 397)),
          sourceAspectRatio
        ),
        faceHeight,
        "jaw height"
      )
    ),
    chinWidth: measured(
      "chinWidth",
      "Chin width",
      ratio(
        distance(point(landmarks, 148), point(landmarks, 377), sourceAspectRatio),
        faceWidth,
        "chin width"
      )
    ),
    chinShape: measured(
      "chinShape",
      "Chin taper",
      ratio(
        distance(point(landmarks, 148), point(landmarks, 377), sourceAspectRatio),
        distance(point(landmarks, 172), point(landmarks, 397), sourceAspectRatio),
        "chin taper"
      )
    ),
    lowerFace: measured(
      "lowerFace",
      "Lower-face length",
      ratio(distance(noseBase, chin, sourceAspectRatio), faceHeight, "lower-face length")
    ),
    eyeWidth: measured("eyeWidth", "Mean eye width", ratio(eyeWidth, faceWidth, "eye width")),
    eyeSpacing: measured(
      "eyeSpacing",
      "Inner-eye spacing",
      ratio(distance(leftEyeInner, rightEyeInner, sourceAspectRatio), faceWidth, "eye spacing")
    ),
    eyeOpenness: measured(
      "eyeOpenness",
      "Eye openness",
      ratio(eyeOpen, eyeWidth, "eye openness")
    ),
    eyeVertical: measured(
      "eyeVertical",
      "Eye vertical position",
      ratio(distance(top, eyeLine, sourceAspectRatio), faceHeight, "eye vertical position")
    ),
    eyeInnerHeight: measured(
      "eyeInnerHeight",
      "Inner eye height",
      ratio(
        (distance(point(landmarks, 133), point(landmarks, 155), sourceAspectRatio) +
          distance(point(landmarks, 362), point(landmarks, 382), sourceAspectRatio)) /
          2,
        eyeWidth,
        "inner eye height"
      )
    ),
    eyeOuterHeight: measured(
      "eyeOuterHeight",
      "Outer eye height",
      ratio(
        (distance(point(landmarks, 33), point(landmarks, 144), sourceAspectRatio) +
          distance(point(landmarks, 263), point(landmarks, 373), sourceAspectRatio)) /
          2,
        eyeWidth,
        "outer eye height"
      )
    ),
    browHeight: measured(
      "browHeight",
      "Brow-to-eye spacing",
      ratio(browHeight, faceHeight, "brow height")
    ),
    browAngle: measured(
      "browAngle",
      "Brow angle",
      ((leftBrowAngle - rightBrowAngle) / 2) * (180 / Math.PI)
    ),
    browWidth: measured(
      "browWidth",
      "Brow width",
      ratio(
        (distance(point(landmarks, 70), point(landmarks, 107), sourceAspectRatio) +
          distance(point(landmarks, 336), point(landmarks, 300), sourceAspectRatio)) /
          2,
        faceWidth,
        "brow width"
      )
    ),
    noseWidth: measured(
      "noseWidth",
      "Nose wing width",
      ratio(
        distance(point(landmarks, 98), point(landmarks, 327), sourceAspectRatio),
        faceWidth,
        "nose width"
      )
    ),
    noseBridgeWidth: measured(
      "noseBridgeWidth",
      "Nose bridge width",
      ratio(
        distance(point(landmarks, 122), point(landmarks, 351), sourceAspectRatio),
        faceWidth,
        "nose bridge width"
      )
    ),
    noseTipWidth: measured(
      "noseTipWidth",
      "Nose tip width",
      ratio(
        distance(point(landmarks, 45), point(landmarks, 275), sourceAspectRatio),
        faceWidth,
        "nose tip width"
      )
    ),
    noseLength: measured(
      "noseLength",
      "Nose length",
      ratio(distance(noseRoot, noseBase, sourceAspectRatio), faceHeight, "nose length")
    ),
    noseVertical: measured(
      "noseVertical",
      "Nose vertical position",
      ratio(distance(top, noseTip, sourceAspectRatio), faceHeight, "nose vertical position")
    ),
    noseRootHeight: measured(
      "noseRootHeight",
      "Nose root position",
      ratio(distance(top, noseRoot, sourceAspectRatio), faceHeight, "nose root height")
    ),
    noseWingHeight: measured(
      "noseWingHeight",
      "Nose wing position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 98), point(landmarks, 327)),
          sourceAspectRatio
        ),
        faceHeight,
        "nose wing height"
      )
    ),
    mouthWidth: measured(
      "mouthWidth",
      "Mouth width",
      ratio(
        distance(point(landmarks, 61), point(landmarks, 291), sourceAspectRatio),
        faceWidth,
        "mouth width"
      )
    ),
    mouthAngle: measured(
      "mouthAngle",
      "Mouth corner angle",
      Math.atan2(
        point(landmarks, 291).y - point(landmarks, 61).y,
        (point(landmarks, 291).x - point(landmarks, 61).x) * sourceAspectRatio
      ) * (180 / Math.PI)
    ),
    philtrumWidth: measured(
      "philtrumWidth",
      "Philtrum width",
      ratio(
        distance(point(landmarks, 37), point(landmarks, 267), sourceAspectRatio),
        faceWidth,
        "philtrum width"
      )
    ),
    upperLip: measured(
      "upperLip",
      "Upper lip thickness",
      ratio(
        distance(point(landmarks, 0), point(landmarks, 13), sourceAspectRatio),
        faceHeight,
        "upper lip"
      )
    ),
    lowerLip: measured(
      "lowerLip",
      "Lower lip thickness",
      ratio(
        distance(point(landmarks, 14), point(landmarks, 17), sourceAspectRatio),
        faceHeight,
        "lower lip"
      )
    ),
    mouthVertical: measured(
      "mouthVertical",
      "Mouth vertical position",
      ratio(distance(top, mouthCenter, sourceAspectRatio), faceHeight, "mouth vertical position")
    ),
    // Corner-to-pupil-line spans separate a narrow inner canthus from a wide one, which is most
    // of what reads as eye "shape" once size and spacing are already accounted for.
    eyeInnerCorner: measured(
      "eyeInnerCorner",
      "Inner corner width",
      ratio(
        (distance(leftEyeInner, point(landmarks, 155), sourceAspectRatio) +
          distance(rightEyeInner, point(landmarks, 382), sourceAspectRatio)) /
          2,
        faceWidth,
        "inner corner width"
      )
    ),
    eyeOuterCorner: measured(
      "eyeOuterCorner",
      "Outer corner width",
      ratio(
        (distance(leftEyeOuter, point(landmarks, 144), sourceAspectRatio) +
          distance(rightEyeOuter, point(landmarks, 373), sourceAspectRatio)) /
          2,
        faceWidth,
        "outer corner width"
      )
    ),
    // How far the lid peak sits above the corner-to-corner line: a hooded lid is flat, an
    // almond lid is domed.
    upperLidCurve: measured(
      "upperLidCurve",
      "Upper lid curve",
      ratio(
        (distance(point(landmarks, 159), leftEyeCenter, sourceAspectRatio) +
          distance(point(landmarks, 386), rightEyeCenter, sourceAspectRatio)) /
          2,
        eyeWidth,
        "upper lid curve"
      )
    ),
    lowerLidCurve: measured(
      "lowerLidCurve",
      "Lower lid curve",
      ratio(
        (distance(point(landmarks, 145), leftEyeCenter, sourceAspectRatio) +
          distance(point(landmarks, 374), rightEyeCenter, sourceAspectRatio)) /
          2,
        eyeWidth,
        "lower lid curve"
      )
    ),
    // Canthal tilt: outer corner above or below the inner one. Measured on the symmetrized mesh,
    // so it reports the shape of the eye rather than any leftover head tilt.
    eyeTilt: measured(
      "eyeTilt",
      "Eye canthal tilt",
      ((Math.atan2(
        leftEyeOuter.y - leftEyeInner.y,
        (leftEyeInner.x - leftEyeOuter.x) * sourceAspectRatio
      ) -
        Math.atan2(
          rightEyeOuter.y - rightEyeInner.y,
          (rightEyeOuter.x - rightEyeInner.x) * sourceAspectRatio
        )) /
        2) *
        (180 / Math.PI)
    ),
    irisSize: measured("irisSize", "Iris size", irisSize),
    browThickness: measured(
      "browThickness",
      "Brow thickness",
      ratio(
        (distance(point(landmarks, 105), point(landmarks, 66), sourceAspectRatio) +
          distance(point(landmarks, 334), point(landmarks, 296), sourceAspectRatio)) /
          2,
        faceHeight,
        "brow thickness"
      )
    ),
    lipFullness: measured(
      "lipFullness",
      "Combined lip thickness",
      ratio(
        distance(point(landmarks, 0), point(landmarks, 17), sourceAspectRatio),
        faceHeight,
        "lip fullness"
      )
    ),
    lipGap: measured(
      "lipGap",
      "Lip separation",
      ratio(
        distance(point(landmarks, 13), point(landmarks, 14), sourceAspectRatio),
        faceHeight,
        "lip separation"
      )
    )
  };

  // Asymmetry that survived de-rolling and un-foreshortening is either genuine or a pose the
  // model could not explain, so it is the honest source-quality signal.
  const symmetry = Math.max(0, Math.min(100, 100 - correction.asymmetryBefore * 6));

  // Fade every measurement the pose residual or a detected expression cannot be trusted to
  // report, so a contaminated feature returns to the neutral baseline instead of being sculpted
  // into the character. This is the same blend the stylized-source normalizer uses.
  const trustResult = measurementTrust(blendshapes, correction, MEASUREMENT_KEYS);
  const faded = Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => {
      const measurement = values[key];
      const confidence = trustResult.confidence[key];
      if (confidence >= 0.999) return [key, measurement];
      const baseline = measurementBaselines[key];
      const value = baseline + (measurement.value - baseline) * confidence;
      return [key, measured(key, measurement.label, value)];
    })
  ) as Record<MeasurementKey, Measurement>;

  const lowTrust = MEASUREMENT_KEYS.filter((key) => trustResult.confidence[key] < 0.35);
  const warnings: string[] = [...correction.notes, ...trustResult.reasons];
  if (lowTrust.length > 0) {
    warnings.push(
      `${lowTrust.length} measurement${lowTrust.length === 1 ? " was" : "s were"} unusable and left at the neutral default: ${lowTrust
        .map((key) => values[key].label.toLowerCase())
        .join(", ")}.`
    );
  }
  if (warnings.length === 0) warnings.push(NO_CORRECTION_NEEDED);

  return {
    measurements: faded,
    sourceAspectRatio,
    symmetry,
    rollDegrees: pose.rollDegrees,
    yawOffset: pose.yawOffset,
    warnings,
    correction,
    trust: trustResult.confidence,
    correctedLandmarks
  };
}

/**
 * Expressive Facegen Morphs sliders are bounded at +/-3 in RaceMenu. Measured from five
 * unrelated, hand-authored preset mods installed on this machine (Bella, Dua Lipa, Lulu, Maya,
 * Natalya): 148 EFM entries, none outside +/-3.00, and four of the five presets touch exactly
 * 3.00 on some slider. Writing values beyond this range is what produced the "over-exaggerated
 * high elf" faces -- FaceForge 0.6.0 emitted up to 8.5.
 */
export const EFM_RANGE = 3;

/**
 * Those same presets sit at mean |value| 0.48-1.11 with a 90th percentile of 1.4-2.3. A photo
 * that deviates strongly from the baseline should therefore approach the limit, not slam into
 * it, so deviation is compressed rather than clipped. tanh keeps the small-deviation response
 * linear and only bends near the edge.
 */
const clamp = (value: number): number => saturate(value, EFM_RANGE);

/** Compresses toward a family's limit instead of clipping flat against it. */
export const saturate = (value: number, range: number): number =>
  range * Math.tanh(value / range);

/**
 * Converts a per-slider sensitivity (kept from 0.6.0, which encodes only the *relative* weight
 * of each measurement) into EFM units. Tuned so an ordinary portrait lands in the 0.3-1.5 band
 * that hand-authored presets occupy instead of pinning several sliders at the maximum.
 */
const RESPONSE_GAIN = 0.18;

const response = (actual: number, baseline: number, sensitivity: number): number =>
  clamp(((actual / baseline) - 1) * sensitivity * RESPONSE_GAIN);
const round = (value: number): number => Math.round(value * 100) / 100;

export const measurementBaselines: Record<MeasurementKey, number> = {
  eyeInnerCorner: 0.055,
  eyeOuterCorner: 0.055,
  upperLidCurve: 0.28,
  lowerLidCurve: 0.22,
  eyeTilt: 0,
  irisSize: 0.115,
  browThickness: 0.03,
  lipFullness: 0.058,
  lipGap: 0.012,
  faceAspect: 1.34,
  cheekWidth: 0.91,
  cheekHeight: 0.5,
  jawWidth: 0.79,
  jawHeight: 0.75,
  chinWidth: 0.24,
  chinShape: 0.32,
  lowerFace: 0.33,
  eyeWidth: 0.18,
  eyeSpacing: 0.2,
  eyeOpenness: 0.31,
  eyeVertical: 0.43,
  eyeInnerHeight: 0.22,
  eyeOuterHeight: 0.22,
  browHeight: 0.075,
  browAngle: 0,
  browWidth: 0.18,
  noseWidth: 0.25,
  noseBridgeWidth: 0.24,
  noseTipWidth: 0.16,
  noseLength: 0.32,
  noseVertical: 0.62,
  noseRootHeight: 0.4,
  noseWingHeight: 0.62,
  mouthWidth: 0.37,
  mouthAngle: 0,
  philtrumWidth: 0.12,
  upperLip: 0.026,
  lowerLip: 0.032,
  mouthVertical: 0.76
};

const stylizedFeatureStrength = (key: MeasurementKey): number => {
  // Stylized face ovals still need stronger normalization after source-image
  // pixel aspect is corrected. Preserve local features more aggressively.
  if (key === "faceAspect") return 1.3;
  if (key.startsWith("eye") || key.startsWith("brow")) return 1;
  if (key.startsWith("nose")) return 0.72;
  if (key === "upperLip" || key === "lowerLip" || key.startsWith("mouth")) return 0.78;
  return 0.6;
};

export function normalizeStylizedAnalysis(
  analysis: FaceAnalysis,
  realismStrength: number
): FaceAnalysis {
  const strength = Math.max(0, Math.min(0.82, realismStrength));
  const measurements = Object.fromEntries(
    Object.entries(analysis.measurements).map(([rawKey, measurement]) => {
      const key = rawKey as MeasurementKey;
      const baseline = measurementBaselines[key];
      const applied = Math.min(0.92, strength * stylizedFeatureStrength(key));
      const value = baseline + (measurement.value - baseline) * (1 - applied);
      return [key, measured(key, measurement.label, value)];
    })
  ) as Record<MeasurementKey, Measurement>;
  return {
    ...analysis,
    measurements,
    warnings: [
      ...analysis.warnings,
      `Stylized source: exaggerated art proportions were normalized ${Math.round(
        strength * 100
      )}% toward believable Skyrim anatomy.`
    ]
  };
}

export function interpretLandmarksForPreview(
  landmarks: readonly FaceLandmark[],
  analysis: FaceAnalysis
): FaceLandmark[] {
  if (landmarks.length < 455) return [...landmarks];

  const top = point(landmarks, 10);
  const chin = point(landmarks, 152);
  const leftEdge = point(landmarks, 234);
  const rightEdge = point(landmarks, 454);
  const rawAspect = ratio(
    distance(top, chin, analysis.sourceAspectRatio),
    distance(leftEdge, rightEdge, analysis.sourceAspectRatio),
    "preview face aspect"
  );
  const targetAspect = analysis.measurements.faceAspect.value;
  const verticalScale = Math.max(0.65, Math.min(1.35, targetAspect / rawAspect));
  const centerY = (top.y + chin.y) / 2;

  return landmarks.map((landmark) => ({
    ...landmark,
    y: centerY + (landmark.y - centerY) * verticalScale
  }));
}

export function projectLandmarksForDiagnostic(
  landmarks: readonly FaceLandmark[],
  analysis: FaceAnalysis,
  centerX = 250,
  centerY = 286,
  faceWidthPixels = 220
): FaceLandmark[] {
  // The diagnostic must show the mesh the sliders were actually measured from, not the raw
  // photo mesh, or a tilted or turned source would display geometry nobody exported.
  const source =
    analysis.correctedLandmarks.length >= 455 ? analysis.correctedLandmarks : landmarks;
  if (source.length < 455) return [];

  const interpreted = interpretLandmarksForPreview(source, analysis);
  const top = point(interpreted, 10);
  const chin = point(interpreted, 152);
  const leftEdge = point(interpreted, 234);
  const rightEdge = point(interpreted, 454);
  const landmarkCenterX = (leftEdge.x + rightEdge.x) / 2;
  const landmarkCenterY = (top.y + chin.y) / 2;
  const faceWidth = distance(leftEdge, rightEdge, analysis.sourceAspectRatio);
  const scale = faceWidthPixels / faceWidth;

  return interpreted.map((landmark) => ({
    ...landmark,
    x:
      centerX +
      (landmark.x - landmarkCenterX) * analysis.sourceAspectRatio * scale,
    y: centerY + (landmark.y - landmarkCenterY) * scale
  }));
}

interface RaceTarget {
  race: string;
  targets: Partial<Record<MeasurementKey, number>>;
  reasons: string[];
}

const raceTargets: RaceTarget[] = [
  {
    race: "Imperial",
    targets: { faceAspect: 1.34, jawWidth: 0.79, chinWidth: 0.24, eyeWidth: 0.18, noseWidth: 0.25 },
    reasons: ["balanced face length", "moderate jaw and feature proportions"]
  },
  {
    race: "Nord",
    targets: { faceAspect: 1.35, jawWidth: 0.83, chinWidth: 0.27, eyeWidth: 0.17, noseWidth: 0.26 },
    reasons: ["broader angular jaw foundation", "long balanced face"]
  },
  {
    race: "Breton",
    targets: { faceAspect: 1.29, jawWidth: 0.75, chinWidth: 0.22, eyeWidth: 0.19, noseWidth: 0.23 },
    reasons: ["compact softer face foundation", "narrow jaw with larger eye proportion"]
  },
  {
    race: "Redguard",
    targets: { faceAspect: 1.33, jawWidth: 0.8, chinWidth: 0.25, cheekWidth: 0.93, noseWidth: 0.27 },
    reasons: ["strong cheek and jaw geometry", "moderately broad nose foundation"]
  },
  {
    race: "High Elf",
    targets: { faceAspect: 1.43, jawWidth: 0.73, chinWidth: 0.21, cheekHeight: 0.47, eyeWidth: 0.18 },
    reasons: ["long narrow facial foundation", "high cheek structure"]
  },
  {
    race: "Wood Elf",
    targets: { faceAspect: 1.31, jawWidth: 0.72, chinWidth: 0.2, cheekHeight: 0.48, eyeWidth: 0.2 },
    reasons: ["compact tapered lower face", "large-eye high-cheek foundation"]
  },
  {
    race: "Dark Elf",
    targets: { faceAspect: 1.38, jawWidth: 0.75, chinWidth: 0.22, cheekWidth: 0.94, eyeWidth: 0.175 },
    reasons: ["angular high-cheek foundation", "longer tapered lower face"]
  },
  {
    race: "Orc",
    targets: { faceAspect: 1.31, jawWidth: 0.87, chinWidth: 0.3, eyeWidth: 0.16, noseWidth: 0.3 },
    reasons: ["very broad jaw and chin foundation", "broad central-face geometry"]
  }
];

const raceTolerance: Partial<Record<MeasurementKey, number>> = {
  faceAspect: 0.14,
  cheekWidth: 0.08,
  cheekHeight: 0.07,
  jawWidth: 0.09,
  chinWidth: 0.06,
  eyeWidth: 0.045,
  noseWidth: 0.065
};

export function recommendRaceFoundations(
  analysis: FaceAnalysis
): RaceRecommendation[] {
  return raceTargets
    .map((target) => {
      const errors = Object.entries(target.targets).map(([rawKey, expected]) => {
        const key = rawKey as MeasurementKey;
        const tolerance = raceTolerance[key] ?? 0.08;
        return Math.abs(analysis.measurements[key].value - expected) / tolerance;
      });
      const distance = Math.sqrt(
        errors.reduce((sum, value) => sum + value * value, 0) / errors.length
      );
      return {
        race: target.race,
        score: Math.round(Math.max(1, Math.min(99, 96 - distance * 24))),
        reasons: target.reasons,
        basis:
          "Geometry-only EFM foundation; skin color and real-world ethnicity are never analyzed."
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function recommendFeatureTargets(analysis: FaceAnalysis): FeatureTarget[] {
  const m = analysis.measurements;
  const browWidth =
    m.browWidth.value > 0.195 ? "wide" : m.browWidth.value < 0.165 ? "compact" : "medium-width";
  const browAngle =
    Math.abs(m.browAngle.value) < 3
      ? "mostly straight"
      : Math.abs(m.browAngle.value) < 8
        ? "softly angled"
        : "strongly angled";
  const eyeScale =
    m.eyeWidth.value > 0.195 ? "larger" : m.eyeWidth.value < 0.165 ? "smaller" : "medium";
  const eyeSpacing =
    m.eyeSpacing.value > 0.215 ? "wide-set" : m.eyeSpacing.value < 0.185 ? "close-set" : "balanced spacing";
  return [
    {
      category: "brows",
      label: `${browWidth}, ${browAngle}`,
      description:
        "Choose this visual shape inside the recommended installed brow pack; FaceForge does not guess an unparsed head-part FormID."
    },
    {
      category: "eyes",
      label: `${eyeScale} eyes, ${eyeSpacing}`,
      description:
        "Use this as the visual target when selecting an installed eye head part in RaceMenu."
    }
  ];
}

const GROUP_TITLES: Record<SliderGroup["id"], string> = {
  face: "Face / Jaw",
  eyes: "Eyes / Brows",
  nose: "Nose",
  mouth: "Mouth / Lips"
};

/**
 * Builds every slider the install offers and FaceForge can measure. Without an inventory this is
 * the EFM family alone; with one it also covers whichever CME, NSK, SPG and RANs sliders that
 * particular RaceMenu defines.
 *
 * Each family gets its own range: an EFM slider runs to +/-3 while a CME slider runs to +/-1, so
 * the same measured deviation produces a proportionally sized value in each.
 */
export function generateEfmSliders(
  analysis: FaceAnalysis,
  inventory: SliderInventory | null = null
): SliderGroup[] {
  const m = analysis.measurements;
  const groups = new Map<SliderGroup["id"], GeneratedSlider[]>([
    ["face", []],
    ["eyes", []],
    ["nose", []],
    ["mouth", []]
  ]);

  for (const definition of selectDefinitions(inventory)) {
    const family = familyOf(definition.name);
    if (!family) continue;
    const range = FAMILY_RANGE[family];
    const measurement = m[definition.source];
    if (!measurement) continue;
    const raw =
      definition.angleDivisor !== undefined
        ? measurement.value / definition.angleDivisor
        : (measurement.value / definition.baseline - 1) * definition.sensitivity * RESPONSE_GAIN;
    groups.get(definition.group)!.push({
      name: definition.name,
      label: definition.label,
      value: round(saturate(raw, range)),
      source: measurement.label,
      confidence: analysis.trust?.[definition.source] ?? 1,
      range
    });
  }

  return [...groups.entries()]
    .filter(([, sliders]) => sliders.length > 0)
    .map(([id, sliders]) => ({ id, title: GROUP_TITLES[id], sliders }));
}

export function createNeutralAnalysis(): FaceAnalysis {
  return {
    measurements: Object.fromEntries(
      MEASUREMENT_KEYS.map((key) => [key, measured(key, key, measurementBaselines[key])])
    ) as Record<MeasurementKey, Measurement>,
    sourceAspectRatio: 1,
    symmetry: 0,
    rollDegrees: 0,
    yawOffset: 0,
    warnings: [],
    correction: {
      pose: { rollDegrees: 0, yawDegrees: 0, pitchDegrees: 0, yawOffset: 0 },
      straightenedDegrees: 0,
      asymmetryBefore: 0,
      asymmetryAfter: 0,
      widthConfidence: 1,
      heightConfidence: 1,
      pairedLandmarks: 0,
      notes: []
    },
    trust: Object.fromEntries(MEASUREMENT_KEYS.map((key) => [key, 1])) as Record<
      MeasurementKey,
      number
    >,
    correctedLandmarks: []
  };
}

export function createNeutralEfmSliders(): SliderGroup[] {
  return generateEfmSliders(createNeutralAnalysis()).map((group) => ({
    ...group,
    sliders: group.sliders.map((slider) => ({
      ...slider,
      value: 0,
      source: "Vision interpretation from neutral"
    }))
  }));
}

export function sliderRecord(groups: readonly SliderGroup[]): Record<string, number> {
  return Object.fromEntries(
    groups.flatMap((group) => group.sliders.map((entry) => [entry.name, entry.value]))
  );
}
