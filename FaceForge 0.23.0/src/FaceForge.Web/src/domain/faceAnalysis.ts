import {
  correctSourceLandmarks,
  estimatePose,
  measurementTrust,
  type AppliedCorrection
} from "./sourceCorrection";
import {
  FAMILY_RANGE,
  SLIDER_DEFINITIONS,
  familyOf,
  selectDefinitions,
  type MorphAvailability,
  type SliderInventory
} from "./sliderCatalog";
import { HPH_BASELINE_FACTORS, responseGainForHead } from "./hphCalibration";

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
  /** RACE EditorID this entry's proportions belong to. */
  editorId: string;
  /**
   * Mean absolute slider value FaceForge would actually export against this race's head, over
   * the proportions that race defines. Lower means the starting head is already closer, so less
   * has to be corrected away.
   */
  correctionEffort: number;
}

/**
 * Optional geometry style that maps measured proportions toward a Skyrim race foundation that
 * already reads closer to that silhouette. This is *not* real-world ethnicity detection: FaceForge
 * never classifies skin color or ancestry. Styles are pure shape recipes the user can apply.
 */
export type ShapeStyleId = "none" | "compactSoftMidface";

export interface ShapeStyleRecommendation {
  id: ShapeStyleId;
  label: string;
  score: number;
  reasons: string[];
  preferredRaces: string[];
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

export interface AnalysisReliability {
  mode: "refine" | "interpret";
  reasons: string[];
}

/**
 * Decide whether optional vision may safely nudge the landmark result or must replace it.
 * A complete MediaPipe mesh is not proof that the pictured geometry was measured reliably.
 */
export function assessAnalysisReliability(
  analysis: Pick<FaceAnalysis, "correction" | "trust">,
  stylized: boolean,
  sourceQuality: number | null,
  sliderValues: Readonly<Record<string, number>>
): AnalysisReliability {
  const reasons: string[] = [];
  if (stylized)
    reasons.push("Stylized art needs semantic interpretation rather than literal landmark proportions.");
  if (sourceQuality !== null && sourceQuality < 0.42)
    reasons.push("The front image quality or pose score is too low for precise landmark refinement.");
  if (Math.min(
    analysis.correction.widthConfidence,
    analysis.correction.heightConfidence
  ) < 0.65)
    reasons.push("The head turn or nod left an axis less than 65% trustworthy.");
  if (analysis.correction.asymmetryBefore >= 12)
    reasons.push("Left/right landmarks disagree too strongly for a stable face estimate.");
  if (analysis.correction.pairedLandmarks > 0 && analysis.correction.pairedLandmarks < 180)
    reasons.push("Too few landmark pairs survived the pose correction.");
  if (Object.values(analysis.trust).filter((confidence) => confidence < 0.35).length >= 8)
    reasons.push("Too many facial measurements were held near neutral.");
  if (Object.values(sliderValues).filter((value) => Math.abs(value) >= 2.7).length >= 4)
    reasons.push("Several generated sliders are pinned near the EFM limit.");
  return { mode: reasons.length > 0 ? "interpret" : "refine", reasons };
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
 * HPH exports use responseGainForHead(true) instead of this constant.
 */
export const RESPONSE_GAIN = 0.18;

const response = (actual: number, baseline: number, sensitivity: number): number =>
  clamp(((actual / baseline) - 1) * sensitivity * RESPONSE_GAIN);
const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * What the neutral Skyrim head measures. A slider is the deviation of a face from this, so an error
 * here is a constant bias on every export, present even for a face that needs no correction at all.
 *
 * Rebased in 0.20.0 onto the mean playable head. 0.19.0 measured the CharGen mesh with no race
 * morph applied -- a head no player ever sees, because every character carries one. Measuring the
 * nine race heads showed the offset that leaves: the average real head is 5.4% longer in the face,
 * 7.2% wider in the chin and 3.5% wider in the nose than the bare mesh. Each calibrated baseline is
 * scaled by its measured mean race factor, so the reference is now the head a player actually
 * starts from.
 *
 * Measured in 0.19.0, not estimated. Front orthographic renders of the four CharGen head meshes at
 * all-zero sliders were fed through this same detector and this same measurement code, so both
 * sides of the comparison come from identical arithmetic and any bias in that arithmetic cancels
 * instead of accumulating. qa/render-head.py made the renders, qa/calibrate-baselines.mjs ran them,
 * qa/baseline-calibration.json holds every number including the ones rejected below.
 *
 * 32 of the 39 were replaced. A value was kept estimated only when the render could not answer it:
 * either the neutral mesh does not carry the feature, or the four heads disagreed by more than half
 * the mean.
 *
 * The feature rule is the one that is easy to miss. Skyrim's eyebrows are a texture painted on a
 * plain forehead slab and the iris is a texture on a plain sphere, so a render shows a browless,
 * iris-less head. The detector still returns brow and iris landmarks -- placed on the brow ridge and
 * on the eyeball -- and reports full confidence in them. They measure something real; it just isn't
 * what the photograph side measures. Calibrating against them would trade a guess for a confidently
 * wrong number.
 *
 * Contaminated readings were recovered rather than discarded. A distrusted measurement is reported
 * as `baseline + (measured - baseline) * trust`, which is exactly invertible, so the eye family --
 * which reads as narrowed on every render, because a bare eyeball has no iris until one is drawn on
 * it -- still yields the number the detector saw. Two consecutive runs agree to the last digit, and
 * re-running against a build already carrying these values reproduces them, which is what says the
 * recovery is not just reproducing the baseline it started from.
 */
export const measurementBaselines: Record<MeasurementKey, number> = {
  eyeInnerCorner: 0.0109,
  eyeOuterCorner: 0.0654,
  upperLidCurve: 0.2631,
  lowerLidCurve: 0.123,
  eyeTilt: 0.0,
  irisSize: 0.115, // estimated: iris is an eye texture, not geometry
  browThickness: 0.03, // estimated: no brow geometry on the neutral mesh
  lipFullness: 0.1585,
  lipGap: 0.012, // estimated: near zero on a closed neutral mouth; the heads disagreed by 175% of the mean
  faceAspect: 1.1407,
  cheekWidth: 0.8736,
  cheekHeight: 0.4854,
  jawWidth: 0.8237,
  jawHeight: 0.7918,
  chinWidth: 0.1913,
  chinShape: 0.2322,
  lowerFace: 0.4106,
  eyeWidth: 0.1961,
  eyeSpacing: 0.2408,
  eyeOpenness: 0.3724,
  eyeVertical: 0.3056,
  eyeInnerHeight: 0.0555,
  eyeOuterHeight: 0.3339,
  browHeight: 0.075, // estimated: no brow geometry on the neutral mesh
  browAngle: 0.0, // estimated: no brow geometry on the neutral mesh
  browWidth: 0.18, // estimated: no brow geometry on the neutral mesh
  noseWidth: 0.2304,
  noseBridgeWidth: 0.0789,
  noseTipWidth: 0.0804,
  noseLength: 0.2771,
  noseVertical: 0.527,
  noseRootHeight: 0.2896,
  noseWingHeight: 0.5583,
  mouthWidth: 0.3494,
  mouthAngle: 0.0,
  philtrumWidth: 0.1004,
  upperLip: 0.0341,
  lowerLip: 0.057,
  mouthVertical: 0.7442
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

export interface RaceTarget {
  race: string;
  /** EditorID prefix used to tie the entry to an installed RACE record. */
  editorIdPrefix: string;
  /** Multipliers on the universal baselines, not absolute values. See the note above. */
  factors: Partial<Record<MeasurementKey, number>>;
  reasons: string[];
}

/**
 * Each playable race starts from a different vanilla head mesh, so a slider value is an offset
 * from *that* race's head, not from some universal average. A preset authored for a Nord and
 * loaded onto a High Elf does not produce the same face, which is why mod authors state the race
 * their preset was built for.
 *
 * These per-race proportions therefore do two jobs: they rank which foundation the photograph is
 * closest to, and -- once a race is chosen -- they replace the universal baselines so the
 * generated offsets are measured from the head the user will actually be sitting on.
 *
 * Elder is measured but not offered. ElderRace is the aged-human head Skyrim uses for old NPCs, not
 * a race anyone creates a character as, and it has no matching installed RACE record to target. It
 * ranked top for a young woman's photograph in 0.20.0 purely because its morph happened to sit
 * nearest her proportions. A candidate the user cannot select is not a recommendation.
 *
 * Measured in 0.20.0, not estimated. Skyrim's playable races share one head mesh; what makes a Nord
 * head a Nord head is a named morph in <sex>HeadRaces.tri -- BretonRace, NordRace, RedguardRace and
 * the rest -- over the same base vertices. Each race's real head was rendered with its own morph
 * applied and measured by the pipeline that reads a photograph. qa/render-head.py --races and
 * qa/calibrate-races.mjs; qa/race-calibration.json holds every number.
 *
 * The numbers they replace were not merely imprecise. Written in 0.12.0 from prose, they described
 * Redguard as "moderately broad nose foundation" at +8% nose width; the actual RedguardRace morph is
 * 3% *narrower* than the playable average. Orc was given +25% chin width and +20% nose width; the
 * real morph is +3.8% and +0.4%. Those figures came from real-world racial stereotype rather than
 * from the game, and they ranked Redguard top for faces that look nothing like a Redguard head. The
 * game states what these heads are. There was never a reason to guess.
 *
 * Every race now defines the same 24 measurements, so the cross-race ranking added in 0.19.1 has a
 * broad comparable set instead of the three proportions the estimates happened to share. The real
 * morphs are also far subtler than the estimates implied: all nine sit within about 5% of each
 * other, which is why the ranking reports so many near-ties. That is the honest answer, not a
 * failure to discriminate.
 *
 * They are stored as multipliers on the universal baselines rather than as absolute proportions.
 * They were absolute until 0.19.0, which is a trap: measuring the real neutral head moved
 * faceAspect from 1.34 to 1.081, and an absolute race table would have gone on overriding it with
 * numbers from the old scale -- so choosing a race would have been *worse* than choosing none.
 * As multipliers they carry only what they actually know, which is how one race differs from the
 * average, and they follow any recalibration for free. The conversion divided each old target by
 * the old universal baseline, so the relative spread is unchanged; Imperial coming out at 1.0
 * across the board is not a rounding artifact, it was the universal baseline all along.
 *
 * The multipliers themselves are still estimates. Measuring each race's own CharGen head would
 * replace them, and now that a head can be rendered and measured, that is a tractable job rather
 * than a roadmap aspiration.
 */
const raceTargets: RaceTarget[] = [
  {
    race: "Breton",
    editorIdPrefix: "BretonRace",
    factors: { faceAspect: 0.981, cheekWidth: 0.995, cheekHeight: 1.013, jawWidth: 1.002, jawHeight: 1.006, chinWidth: 0.993, chinShape: 0.992, eyeWidth: 0.993, eyeSpacing: 0.984, eyeVertical: 1.019, eyeInnerHeight: 1.007, eyeOuterHeight: 0.994, noseWidth: 0.992, noseBridgeWidth: 0.998, noseTipWidth: 0.998, noseLength: 1.002, noseVertical: 1.013, noseRootHeight: 1.023, noseWingHeight: 1.012, eyeInnerCorner: 0.999, eyeOuterCorner: 0.987, upperLidCurve: 1.009, lowerLidCurve: 0.978, lipFullness: 0.882 },
    reasons: ["longer face 1.8% below the playable average", "wider-set eyes 1.8% below the playable average"]
  },
  {
    race: "Dark Elf",
    editorIdPrefix: "DarkElfRace",
    factors: { faceAspect: 1.035, cheekWidth: 1.007, cheekHeight: 0.989, jawWidth: 0.977, jawHeight: 0.98, chinWidth: 0.987, chinShape: 1.01, eyeWidth: 1.017, eyeSpacing: 1.056, eyeVertical: 0.995, eyeInnerHeight: 1.032, eyeOuterHeight: 1.013, noseWidth: 1.02, noseBridgeWidth: 1.03, noseTipWidth: 1.02, noseLength: 1.003, noseVertical: 1.007, noseRootHeight: 1.002, noseWingHeight: 1.0, eyeInnerCorner: 1.05, eyeOuterCorner: 1.03, upperLidCurve: 0.924, lowerLidCurve: 1.067, lipFullness: 1.122 },
    reasons: ["wider-set eyes 5.4% above the playable average", "longer face 3.7% above the playable average"]
  },
  {
    race: "High Elf",
    editorIdPrefix: "HighElfRace",
    factors: { faceAspect: 1.027, cheekWidth: 0.998, cheekHeight: 0.974, jawWidth: 0.993, jawHeight: 0.977, chinWidth: 1.022, chinShape: 1.029, eyeWidth: 1.005, eyeSpacing: 0.999, eyeVertical: 0.975, eyeInnerHeight: 0.967, eyeOuterHeight: 1.004, noseWidth: 1.014, noseBridgeWidth: 1.007, noseTipWidth: 1.017, noseLength: 0.992, noseVertical: 0.984, noseRootHeight: 0.972, noseWingHeight: 0.979, eyeInnerCorner: 0.972, eyeOuterCorner: 1.011, upperLidCurve: 1.025, lowerLidCurve: 1.05, lipFullness: 1.1 },
    reasons: ["squarer chin 3.1% above the playable average", "higher cheeks 2.9% below the playable average"]
  },
  {
    race: "Imperial",
    editorIdPrefix: "ImperialRace",
    factors: { faceAspect: 0.985, cheekWidth: 1.001, cheekHeight: 1.017, jawWidth: 1.004, jawHeight: 1.01, chinWidth: 0.985, chinShape: 0.982, eyeWidth: 0.993, eyeSpacing: 0.995, eyeVertical: 1.019, eyeInnerHeight: 0.981, eyeOuterHeight: 1.004, noseWidth: 0.992, noseBridgeWidth: 1.0, noseTipWidth: 0.998, noseLength: 1.016, noseVertical: 1.025, noseRootHeight: 1.029, noseWingHeight: 1.022, eyeInnerCorner: 0.974, eyeOuterCorner: 0.996, upperLidCurve: 1.002, lowerLidCurve: 1.003, lipFullness: 0.862 },
    reasons: ["squarer chin 1.6% below the playable average", "higher eyes 1.5% above the playable average"]
  },
  {
    race: "Nord",
    editorIdPrefix: "NordRace",
    factors: { faceAspect: 0.979, cheekWidth: 0.996, cheekHeight: 1.018, jawWidth: 1.007, jawHeight: 1.012, chinWidth: 0.993, chinShape: 0.985, eyeWidth: 0.985, eyeSpacing: 0.972, eyeVertical: 1.023, eyeInnerHeight: 1.012, eyeOuterHeight: 0.988, noseWidth: 0.984, noseBridgeWidth: 0.984, noseTipWidth: 0.982, noseLength: 1.004, noseVertical: 1.013, noseRootHeight: 1.025, noseWingHeight: 1.015, eyeInnerCorner: 0.996, eyeOuterCorner: 0.973, upperLidCurve: 0.983, lowerLidCurve: 0.98, lipFullness: 0.866 },
    reasons: ["wider-set eyes 3.0% below the playable average", "longer face 2.0% below the playable average"]
  },
  {
    race: "Orc",
    editorIdPrefix: "OrcRace",
    factors: { faceAspect: 0.996, cheekWidth: 1.003, cheekHeight: 0.987, jawWidth: 1.031, jawHeight: 1.014, chinWidth: 1.036, chinShape: 1.005, eyeWidth: 0.996, eyeSpacing: 0.976, eyeVertical: 0.972, eyeInnerHeight: 1.032, eyeOuterHeight: 0.981, noseWidth: 1.004, noseBridgeWidth: 0.987, noseTipWidth: 0.997, noseLength: 0.97, noseVertical: 0.956, noseRootHeight: 0.955, noseWingHeight: 0.966, eyeInnerCorner: 1.027, eyeOuterCorner: 0.977, upperLidCurve: 1.055, lowerLidCurve: 0.958, lipFullness: 1.118 },
    reasons: ["wider chin 3.8% above the playable average", "higher eyes 3.2% below the playable average"]
  },
  {
    race: "Redguard",
    editorIdPrefix: "RedguardRace",
    factors: { faceAspect: 0.963, cheekWidth: 0.998, cheekHeight: 1.02, jawWidth: 1.003, jawHeight: 1.015, chinWidth: 0.976, chinShape: 0.972, eyeWidth: 0.998, eyeSpacing: 0.991, eyeVertical: 1.021, eyeInnerHeight: 0.951, eyeOuterHeight: 1.016, noseWidth: 0.969, noseBridgeWidth: 0.986, noseTipWidth: 0.975, noseLength: 1.021, noseVertical: 1.02, noseRootHeight: 1.024, noseWingHeight: 1.022, eyeInnerCorner: 0.95, eyeOuterCorner: 1.014, upperLidCurve: 0.961, lowerLidCurve: 0.989, lipFullness: 0.809 },
    reasons: ["longer face 3.6% below the playable average", "wider nose 3.1% below the playable average"]
  },
  {
    race: "Wood Elf",
    editorIdPrefix: "WoodElfRace",
    factors: { faceAspect: 1.034, cheekWidth: 1.0, cheekHeight: 0.981, jawWidth: 0.984, jawHeight: 0.984, chinWidth: 1.007, chinShape: 1.023, eyeWidth: 1.015, eyeSpacing: 1.028, eyeVertical: 0.978, eyeInnerHeight: 1.02, eyeOuterHeight: 0.996, noseWidth: 1.025, noseBridgeWidth: 1.012, noseTipWidth: 1.017, noseLength: 0.989, noseVertical: 0.983, noseRootHeight: 0.973, noseWingHeight: 0.982, eyeInnerCorner: 1.033, eyeOuterCorner: 1.012, upperLidCurve: 1.039, lowerLidCurve: 0.977, lipFullness: 1.24 },
    reasons: ["longer face 3.6% above the playable average", "wider-set eyes 2.6% above the playable average"]
  }
];

/** Retained for reference: the tolerance constants the pre-0.18.0 abstract ranking used. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const raceTolerance: Partial<Record<MeasurementKey, number>> = {
  faceAspect: 0.14,
  cheekWidth: 0.08,
  cheekHeight: 0.07,
  jawWidth: 0.09,
  chinWidth: 0.06,
  eyeWidth: 0.045,
  noseWidth: 0.065
};

export type TargetSex = "male" | "female";

/**
 * Optional sex touch-up multipliers applied on top of race baselines. Values are deliberately
 * small (~2–4%): enough that a male foundation feels a touch more angular and a female foundation
 * a touch softer, without rewriting the photograph.
 *
 * Multipliers below 1.0 lower the baseline, so the same measured feature produces a *higher*
 * slider (more of that feature). Multipliers above 1.0 do the opposite.
 */
const sexTouchUpFactors: Record<TargetSex, Partial<Record<MeasurementKey, number>>> = {
  male: {
    // A bit more jaw, chin, brow bulk, and central-face structure.
    jawWidth: 0.97,
    chinWidth: 0.97,
    cheekWidth: 0.985,
    noseWidth: 0.98,
    browThickness: 0.97,
    browWidth: 0.98,
    // Slightly less eye/lip softness so the face reads firmer, not cartoon-hard.
    eyeWidth: 1.03,
    eyeOpenness: 1.02,
    lipFullness: 1.03,
    upperLip: 1.03,
    lowerLip: 1.02,
    cheekHeight: 1.015
  },
  female: {
    // Softer lower face, slightly larger eyes, a touch more lip.
    jawWidth: 1.03,
    chinWidth: 1.035,
    cheekWidth: 1.015,
    noseWidth: 1.02,
    browThickness: 1.03,
    browWidth: 1.02,
    eyeWidth: 0.97,
    eyeOpenness: 0.985,
    lipFullness: 0.97,
    upperLip: 0.97,
    lowerLip: 0.975,
    cheekHeight: 0.985
  }
};

/**
 * Baselines for slider generation. With no race chosen these are the universal averages; with one
 * chosen, every proportion that race defines is replaced by its own, so the exported values are
 * offsets from that race's starting head rather than from a generic face.
 */
export function baselinesForRace(
  raceEditorId: string | null
): Record<MeasurementKey, number> {
  if (!raceEditorId) return measurementBaselines;
  const match = raceTargets.find((target) =>
    raceEditorId.toLowerCase().startsWith(target.editorIdPrefix.toLowerCase())
  );
  if (!match) return measurementBaselines;
  return applyBaselineFactors(measurementBaselines, match.factors);
}

/**
 * Optional shape-style baseline multipliers. Strength is intentionally modest (~3–6%): enough to
 * lean the export toward a silhouette authors already sculpt by hand, without inventing ancestry
 * from the photograph.
 *
 * Evidence for compactSoftMidface comes from hand-authored EFM presets that target that look
 * (e.g. YUYOU PRESET 2): very narrow bridge/cheek width, reduced wing thickness, compact lower
 * face, higher cheek, slightly larger eyes. Depth-only sculpt and foreign head systems (UBE, NIF
 * overlays) are ignored — FaceForge cannot replay those.
 */
const shapeStyleFactors: Record<
  Exclude<ShapeStyleId, "none">,
  Partial<Record<MeasurementKey, number>>
> = {
  compactSoftMidface: {
    // Narrower midface / bridge / wings → lower baseline → more of those features in the export.
    cheekWidth: 0.94,
    noseBridgeWidth: 0.93,
    noseWidth: 0.96,
    noseTipWidth: 0.96,
    jawWidth: 0.97,
    chinWidth: 0.97,
    // Slightly larger eyes and a touch more lid presence.
    eyeWidth: 0.96,
    eyeOpenness: 0.98,
    eyeOuterCorner: 0.97,
    // Softer brow bulk, a bit more cheek height.
    browThickness: 1.03,
    cheekHeight: 0.98,
    lowerFace: 0.98
  }
};

const applyBaselineFactors = (
  base: Record<MeasurementKey, number>,
  factors: Partial<Record<MeasurementKey, number>> | undefined
): Record<MeasurementKey, number> => {
  if (!factors) return base;
  const next = { ...base };
  for (const [rawKey, factor] of Object.entries(factors)) {
    const key = rawKey as MeasurementKey;
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) continue;
    next[key] = base[key] * factor;
  }
  return next;
};

/**
 * Race baselines, optionally nudged by light male/female, shape-style, and High Poly Head
 * touch-ups. Sex/style are off unless asked; HPH factors apply when the selected face mesh is HPH.
 */
export function baselinesForTarget(
  raceEditorId: string | null,
  sex: TargetSex | null = null,
  sexTouchUp = false,
  shapeStyle: ShapeStyleId = "none",
  highPolyHead = false
): Record<MeasurementKey, number> {
  let base = baselinesForRace(raceEditorId);
  if (sexTouchUp && sex) base = applyBaselineFactors(base, sexTouchUpFactors[sex]);
  if (shapeStyle !== "none") base = applyBaselineFactors(base, shapeStyleFactors[shapeStyle]);
  if (highPolyHead) base = applyBaselineFactors(base, HPH_BASELINE_FACTORS);
  return base;
}

export interface ShapeStyleDefinition {
  id: Exclude<ShapeStyleId, "none">;
  label: string;
  /** Plain-language what the style does to proportions. */
  summary: string;
  /** Skyrim race display names that already start closer to this silhouette. */
  preferredRaces: string[];
  /** Measurement targets used only to score whether the photo already leans this way. */
  cues: Partial<Record<MeasurementKey, number>>;
  reasons: string[];
}

/**
 * Geometry styles the user can opt into. Ranking is measurement-only; applying a style only
 * nudges baselines and (when the user accepts) can pre-select a preferred race foundation.
 */
export const shapeStyleCatalog: readonly ShapeStyleDefinition[] = [
  {
    id: "compactSoftMidface",
    label: "Compact soft midface",
    summary:
      "Narrower cheeks and nose bridge, softer jaw, slightly larger eyes — a silhouette common in hand-authored HPH presets that target that look. Not ethnicity detection.",
    preferredRaces: ["Breton", "Wood Elf", "Imperial"],
    cues: {
      cheekWidth: 0.86,
      noseBridgeWidth: 0.21,
      noseWidth: 0.23,
      jawWidth: 0.74,
      eyeWidth: 0.195,
      cheekHeight: 0.52
    },
    reasons: [
      "narrow midface and bridge proportion",
      "compact softer lower face",
      "larger eye-to-face ratio"
    ]
  }
];

const shapeStyleTolerance: Partial<Record<MeasurementKey, number>> = {
  cheekWidth: 0.09,
  noseBridgeWidth: 0.05,
  noseWidth: 0.06,
  jawWidth: 0.09,
  eyeWidth: 0.04,
  cheekHeight: 0.07
};

/**
 * Scores optional geometry styles against the photograph. Never labels real-world ethnicity;
 * only reports how close the measured silhouette already is to each style's shape cues.
 */
export function recommendShapeStyles(analysis: FaceAnalysis): ShapeStyleRecommendation[] {
  return shapeStyleCatalog
    .map((style) => {
      const errors = Object.entries(style.cues).map(([rawKey, expected]) => {
        const key = rawKey as MeasurementKey;
        const tolerance = shapeStyleTolerance[key] ?? 0.08;
        return Math.abs(analysis.measurements[key].value - expected) / tolerance;
      });
      const distance = Math.sqrt(
        errors.reduce((sum, value) => sum + value * value, 0) / Math.max(1, errors.length)
      );
      return {
        id: style.id,
        label: style.label,
        score: Math.round(Math.max(1, Math.min(99, 94 - distance * 22))),
        reasons: style.reasons,
        preferredRaces: [...style.preferredRaces],
        basis:
          "Geometry style only. FaceForge does not detect real-world ethnicity or skin color; this is an optional silhouette nudge toward Skyrim race foundations that already fit."
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function shapeStyleDefinition(
  id: ShapeStyleId
): ShapeStyleDefinition | null {
  if (id === "none") return null;
  return shapeStyleCatalog.find((entry) => entry.id === id) ?? null;
}

/** The race entry a chosen RACE record maps onto, if FaceForge has proportions for it. */
export function raceFoundationFor(raceEditorId: string | null): RaceTarget | null {
  if (!raceEditorId) return null;
  return (
    raceTargets.find((target) =>
      raceEditorId.toLowerCase().startsWith(target.editorIdPrefix.toLowerCase())
    ) ?? null
  );
}

/**
 * Ranks race foundations by how much correction each one actually needs.
 *
 * Every playable race starts from a different vanilla head, so a slider is an offset from *that*
 * head. The best foundation is therefore the one whose starting head is already closest to the
 * photograph, because it leaves the least to correct away.
 *
 * Earlier versions scored an abstract distance with per-measurement tolerance constants that had
 * no relationship to the exported values, so the ranking and the sliders could disagree: a race
 * could be recommended and then produce large corrections. This runs the real generator against
 * each race and measures the result, so the recommendation is a statement about the output.
 *
 * Only the proportions a race actually defines are scored. Sliders driven by measurements no race
 * distinguishes are identical for every candidate and would just add a constant to all of them.
 */
/**
 * Measurements every race in the table estimates, and therefore the only ones a ranking may use.
 *
 * Each race defines four or five proportions, but not the same four or five: Redguard is the only
 * one that estimates `cheekWidth` alongside `noseWidth`, the elves swap in `cheekHeight`, and the
 * rest use `eyeWidth`. Averaging each race's correction over its own set and then sorting those
 * averages against each other grades every candidate on a different exam -- a face near Redguard's
 * cheek estimate wins on a dimension no other race is tested on. Ranking over the intersection is
 * thinner but comparable, which is the property a ranking actually needs.
 *
 * The per-race extras are still used as baselines when generating sliders. There they are a
 * statement about one race's head and stand on their own; only the cross-race comparison requires
 * a common set.
 */
export const rankingKeys: MeasurementKey[] = (Object.keys(raceTargets[0].factors) as MeasurementKey[])
  .filter((key) => raceTargets.every((target) => key in target.factors));

/**
 * Candidates within half a percent of the best fit are not a real preference. The measured race
 * morphs sit within about five percent of each other in total, so half a percent is genuinely
 * inside the noise of a single photograph.
 */
export const RACE_TIE_MARGIN = 0.005;

export function recommendRaceFoundations(
  analysis: FaceAnalysis,
  inventory: SliderInventory | null = null
): RaceRecommendation[] {
  // Compared in measurement space, not slider space. Going through the sliders puts every
  // comparison through per-slider sensitivities and a clamp, which are tuned for describing one
  // face rather than for telling two near-identical heads apart -- and the measured race morphs are
  // near-identical, within about five percent of each other. Under that metric a race's OWN head
  // did not reliably rank it first: Imperial's head, sitting close to the average, came fourth.
  // Mean relative distance per proportion is what "how far is this face from that head" actually
  // means, and it makes the identity case exact rather than approximate.
  const ranked = raceTargets
    .map((target) => {
      const baselines = baselinesForRace(target.editorIdPrefix);
      const errors = rankingKeys
        .map((key) => {
          const baseline = baselines[key];
          if (!baseline) return null;
          return Math.abs(analysis.measurements[key].value / baseline - 1);
        })
        .filter((error): error is number => error !== null);
      const correctionEffort =
        errors.length > 0 ? errors.reduce((sum, error) => sum + error, 0) / errors.length : 0;
      return { target, correctionEffort };
    })
    .sort((a, b) => a.correctionEffort - b.correctionEffort)
    .slice(0, 3);

  // 0.19.0 measured the baselines and shrank every slider by roughly six times, which quietly
  // squeezed the old `99 - effort * 45` mapping into a narrow band at the top: unrelated races came
  // out 88, 88 and 83, presenting what is nearly a coin toss as a confident percentage. Scoring
  // against the tie margin keeps a genuinely close foundation near the top without inventing a
  // preference between candidates that measure the same.
  const best = ranked[0]?.correctionEffort ?? 0;
  return ranked.map(({ target, correctionEffort }) => {
    const tied = correctionEffort - best < RACE_TIE_MARGIN;
    return {
      race: target.race,
      editorId: target.editorIdPrefix,
      correctionEffort: Math.round(correctionEffort * 1000) / 1000,
      // Display mapping only; the ordering is correctionEffort and near-ties are labelled below.
      score: Math.round(Math.max(1, Math.min(99, 99 - correctionEffort * 400))),
      reasons: tied
        ? [...target.reasons, "measures the same as the others here -- pick on looks, not the order"]
        : target.reasons,
      basis:
        `Ranked over the ${rankingKeys.length} proportions every race estimates, by how little ` +
        "correction its own starting head needs. Skin color and real-world ethnicity are never analyzed."
    };
  });
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
  inventory: SliderInventory | null = null,
  raceEditorId: string | null = null,
  sex: TargetSex | null = null,
  sexTouchUp = false,
  shapeStyle: ShapeStyleId = "none",
  highPolyHead = false,
  availability: MorphAvailability | null = null
): SliderGroup[] {
  // A slider is an offset from the chosen race's own head, not from a generic face, so the
  // baseline each measurement is compared against depends on the race the user targets.
  // Optional sex / shape-style touch-ups then nudge those baselines slightly — off by default
  // so the photograph stays authoritative. HPH raises response gain and midface factors.
  const baselines = baselinesForTarget(
    raceEditorId,
    sex,
    sexTouchUp,
    shapeStyle,
    highPolyHead
  );
  const gain = responseGainForHead(highPolyHead);
  const m = analysis.measurements;
  const groups = new Map<SliderGroup["id"], GeneratedSlider[]>([
    ["face", []],
    ["eyes", []],
    ["nose", []],
    ["mouth", []]
  ]);

  for (const definition of selectDefinitions(inventory, availability)) {
    const family = familyOf(definition.name);
    if (!family) continue;
    const range = FAMILY_RANGE[family];
    const measurement = m[definition.source];
    if (!measurement) continue;
    const baseline = baselines[definition.source];
    const raw =
      definition.angleDivisor !== undefined
        ? measurement.value / definition.angleDivisor
        : (measurement.value / baseline - 1) * definition.sensitivity * gain;
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
