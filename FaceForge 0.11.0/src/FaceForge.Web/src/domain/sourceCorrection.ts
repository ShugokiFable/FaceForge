import type { FaceLandmark, MeasurementKey } from "./faceAnalysis";

/**
 * Nothing here tries to turn a bad photo into a good one. It does two separate jobs:
 *
 *  - **Correct** what is geometrically recoverable. A tilted head is a 2D rotation and can be
 *    undone exactly. A turned or raised head foreshortens one axis by a cosine that can be
 *    divided back out. Left/right differences caused by pose are removed by mirror-averaging,
 *    which is safe because EFM sliders are bilateral -- Skyrim cannot express an asymmetric
 *    face anyway, so measuring one pose-biased side is strictly worse than averaging both.
 *
 *  - **Distrust** what is not recoverable. A smile genuinely widens the mouth and a blink
 *    genuinely closes the eye; no amount of maths recovers the neutral shape from one frame.
 *    Those measurements are faded toward the neutral baseline in proportion to how contaminated
 *    they are, so a grin becomes "mouth width unknown, left at default" instead of a character
 *    permanently grinning.
 */

export interface PoseEstimate {
  /** In-plane tilt, from the eye line. Recovered exactly. */
  rollDegrees: number;
  /** Head turn about the vertical axis, from the depth of the two face edges. */
  yawDegrees: number;
  /** Head nod, from the depth of the forehead against the chin. */
  pitchDegrees: number;
  /** Legacy nose-offset signal, kept because view selection and warnings use it. */
  yawOffset: number;
}

export interface AppliedCorrection {
  pose: PoseEstimate;
  /**
   * Tilt removed from the image itself before landmark detection ran, if any. The landmark model
   * is not rotation invariant, so this is set by the caller that straightened the source and is
   * added to `pose.rollDegrees` for reporting.
   */
  straightenedDegrees: number;
  /** Mean left/right landmark disagreement before and after mirror-averaging, in percent. */
  asymmetryBefore: number;
  asymmetryAfter: number;
  /** How far horizontal and vertical proportions can still be trusted after un-foreshortening. */
  widthConfidence: number;
  heightConfidence: number;
  /** Landmarks that were mirror-paired. Low counts mean the mesh was too distorted to pair. */
  pairedLandmarks: number;
  notes: string[];
}

const DEGREES = 180 / Math.PI;

/**
 * Rotations are estimated in a space where one horizontal unit equals one vertical unit.
 * MediaPipe normalizes x by image width and y by image height, and its z is scaled like x.
 */
const toMetric = (
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): FaceLandmark[] =>
  landmarks.map((point) => ({
    x: point.x * sourceAspectRatio,
    y: point.y,
    z: (point.z ?? 0) * sourceAspectRatio
  }));

const fromMetric = (
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): FaceLandmark[] =>
  landmarks.map((point) => ({
    x: point.x / sourceAspectRatio,
    y: point.y,
    z: (point.z ?? 0) / sourceAspectRatio
  }));

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Confidence ramp: full trust up to `good`, none past `bad`. */
const ramp = (magnitude: number, good: number, bad: number) =>
  clamp(1 - (Math.abs(magnitude) - good) / (bad - good), 0, 1);

export function estimatePose(
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): PoseEstimate {
  const metric = toMetric(landmarks, sourceAspectRatio);
  const top = metric[10];
  const chin = metric[152];
  const leftEdge = metric[234];
  const rightEdge = metric[454];
  const leftEye = metric[33];
  const rightEye = metric[263];
  const noseTip = metric[1];
  if (!top || !chin || !leftEdge || !rightEdge || !leftEye || !rightEye || !noseTip) {
    return { rollDegrees: 0, yawDegrees: 0, pitchDegrees: 0, yawOffset: 0 };
  }

  const rollDegrees =
    Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * DEGREES;

  // A head turned by yaw swings the far cheek away from the camera, so the two face edges end
  // up at different depths. atan2 of that depth difference against their apparent separation is
  // the turn angle, and it needs no assumption about how far the nose sticks out.
  const yawDegrees =
    Math.atan2(-((rightEdge.z ?? 0) - (leftEdge.z ?? 0)), rightEdge.x - leftEdge.x) * DEGREES;
  const pitchDegrees =
    Math.atan2((chin.z ?? 0) - (top.z ?? 0), chin.y - top.y) * DEGREES;

  const faceWidth = Math.hypot(rightEdge.x - leftEdge.x, rightEdge.y - leftEdge.y);
  const yawOffset =
    faceWidth > 0
      ? Math.abs(noseTip.x - (leftEdge.x + rightEdge.x) / 2) / faceWidth
      : 0;

  return {
    rollDegrees: Number.isFinite(rollDegrees) ? rollDegrees : 0,
    yawDegrees: Number.isFinite(yawDegrees) ? clamp(yawDegrees, -60, 60) : 0,
    pitchDegrees: Number.isFinite(pitchDegrees) ? clamp(pitchDegrees, -50, 50) : 0,
    yawOffset
  };
}

/**
 * Pairs landmarks with their mirror across the face's own symmetry axis.
 *
 * The measurement landmarks come from the fixed table above and are always paired. Everything
 * else -- the contour points that only feed the on-screen diagnostic mesh -- is matched by mutual
 * nearest neighbour within a tight radius, so a mismatch there is cosmetic and a point that finds
 * no confident partner is simply left alone.
 */
function mirrorPairs(
  metric: readonly FaceLandmark[],
  axisX: number,
  faceWidth: number
): Int32Array {
  const pairs = new Int32Array(metric.length).fill(-1);
  for (const [left, right] of KEY_PAIRS) {
    if (metric[left] && metric[right]) {
      pairs[left] = right;
      pairs[right] = left;
    }
  }
  for (const index of KEY_MIDLINE) {
    if (metric[index]) pairs[index] = index;
  }

  const tolerance = faceWidth * 0.035;
  const best = new Int32Array(metric.length).fill(-1);
  const bestDistance = new Float64Array(metric.length).fill(Infinity);

  for (let index = 0; index < metric.length; index += 1) {
    if (pairs[index] >= 0) continue;
    const point = metric[index];
    if (!point) continue;
    const mirroredX = 2 * axisX - point.x;
    for (let other = 0; other < metric.length; other += 1) {
      if (pairs[other] >= 0) continue;
      const candidate = metric[other];
      if (!candidate) continue;
      const distance = Math.hypot(candidate.x - mirroredX, candidate.y - point.y);
      if (distance < bestDistance[index]) {
        bestDistance[index] = distance;
        best[index] = other;
      }
    }
  }

  for (let index = 0; index < metric.length; index += 1) {
    if (pairs[index] >= 0) continue;
    const other = best[index];
    // Mutual agreement plus a tight radius. A point whose mirror is itself is on the midline.
    if (other >= 0 && best[other] === index && bestDistance[index] <= tolerance) {
      pairs[index] = other;
    }
  }
  return pairs;
}

/**
 * Mean left/right disagreement over the measurement landmarks only, as a percentage of face
 * width. Restricted to the fixed pairs so the number means the same thing on every image
 * regardless of how many contour points happened to match.
 */
const asymmetryOf = (
  metric: readonly FaceLandmark[],
  axisX: number,
  faceWidth: number
): number => {
  let total = 0;
  let count = 0;
  for (const [left, right] of KEY_PAIRS) {
    const a = metric[left];
    const b = metric[right];
    if (!a || !b) continue;
    total +=
      Math.abs(Math.abs(a.x - axisX) - Math.abs(b.x - axisX)) + Math.abs(a.y - b.y);
    count += 1;
  }
  return count > 0 && faceWidth > 0 ? (total / count / faceWidth) * 100 : 0;
};

/** Beyond this the cosine correction amplifies landmark noise faster than it recovers shape. */
const MAX_CORRECTED_ANGLE = 32;

/**
 * Every bilateral landmark the measurements are built from. These are fixed properties of the
 * MediaPipe topology, so they are stated outright rather than rediscovered per image: an
 * asymmetric face is exactly the case where geometric rediscovery fails, and that is the case
 * this whole module exists to handle.
 */
const KEY_PAIRS: Array<[number, number]> = [
  [234, 454], // face edges
  [123, 352], // cheeks
  [172, 397], // jaw
  [148, 377], // chin
  [33, 263], // eye outer corners
  [133, 362], // eye inner corners
  [159, 386], // upper lids
  [145, 374], // lower lids
  [155, 382], // inner lower lids
  [144, 373], // outer lower lids
  [70, 300], // brow outer
  [107, 336], // brow inner
  [122, 351], // nose bridge
  [45, 275], // nose tip sides
  [98, 327], // nose wings
  [61, 291], // mouth corners
  [37, 267] // philtrum
];

/** Landmarks that sit on the face's own centre line and therefore mirror onto themselves. */
const KEY_MIDLINE = [10, 152, 168, 1, 2, 0, 13, 14, 17];

export function correctSourceLandmarks(
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): { landmarks: FaceLandmark[]; correction: AppliedCorrection } {
  const pose = estimatePose(landmarks, sourceAspectRatio);
  const notes: string[] = [];
  let metric = toMetric(landmarks, sourceAspectRatio);

  const top = metric[10];
  const chin = metric[152];
  const leftEdge = metric[234];
  const rightEdge = metric[454];
  if (!top || !chin || !leftEdge || !rightEdge) {
    return {
      landmarks: [...landmarks],
      correction: {
        pose,
        straightenedDegrees: 0,
        asymmetryBefore: 0,
        asymmetryAfter: 0,
        widthConfidence: 1,
        heightConfidence: 1,
        pairedLandmarks: 0,
        notes: ["Pose correction was skipped: the landmark mesh is incomplete."]
      }
    };
  }

  const centerX = (leftEdge.x + rightEdge.x) / 2;
  const centerY = (top.y + chin.y) / 2;

  // 1. Undo the in-plane tilt. This one is exact.
  if (Math.abs(pose.rollDegrees) > 0.4) {
    const angle = -pose.rollDegrees / DEGREES;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    metric = metric.map((point) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      return {
        x: centerX + dx * cos - dy * sin,
        y: centerY + dx * sin + dy * cos,
        z: point.z
      };
    });
    notes.push(`Head tilt of ${pose.rollDegrees.toFixed(1)}° was rotated out.`);
  }

  // 2. Undo foreshortening. A turn compresses horizontal extents by cos(yaw) and a nod
  //    compresses vertical extents by cos(pitch), so divide each axis back out about the face
  //    centre. Correction stops at MAX_CORRECTED_ANGLE; past that the residual is reported as
  //    lost confidence instead of being scaled up.
  const correctedYaw = clamp(pose.yawDegrees, -MAX_CORRECTED_ANGLE, MAX_CORRECTED_ANGLE);
  const correctedPitch = clamp(pose.pitchDegrees, -MAX_CORRECTED_ANGLE, MAX_CORRECTED_ANGLE);
  const widthScale = 1 / Math.cos(correctedYaw / DEGREES);
  const heightScale = 1 / Math.cos(correctedPitch / DEGREES);
  if (Math.abs(correctedYaw) > 2 || Math.abs(correctedPitch) > 2) {
    metric = metric.map((point) => ({
      x: centerX + (point.x - centerX) * widthScale,
      y: centerY + (point.y - centerY) * heightScale,
      z: point.z
    }));
    if (Math.abs(correctedYaw) > 2) {
      notes.push(
        `Head turn of ${Math.abs(pose.yawDegrees).toFixed(1)}° was un-foreshortened; widths were scaled by ${widthScale.toFixed(3)}.`
      );
    }
    if (Math.abs(correctedPitch) > 2) {
      notes.push(
        `Head nod of ${Math.abs(pose.pitchDegrees).toFixed(1)}° was un-foreshortened; heights were scaled by ${heightScale.toFixed(3)}.`
      );
    }
  }

  // 3. Mirror-average. Skyrim's EFM sliders are bilateral, so a symmetric input is the only
  //    thing the output can represent; averaging both sides beats trusting the nearer one.
  const axisX = (metric[234].x + metric[454].x) / 2;
  const faceWidth = Math.abs(metric[454].x - metric[234].x);
  const pairs = mirrorPairs(metric, axisX, faceWidth);
  const asymmetryBefore = asymmetryOf(metric, axisX, faceWidth);
  const symmetric = metric.map((point) => ({ ...point }));
  let pairedLandmarks = 0;
  for (let index = 0; index < metric.length; index += 1) {
    const other = pairs[index];
    if (other < 0) continue;
    pairedLandmarks += 1;
    if (other === index) {
      symmetric[index].x = axisX;
      continue;
    }
    if (other < index) continue;
    const a = metric[index];
    const b = metric[other];
    const offset = (a.x - axisX - (b.x - axisX)) / 2;
    const y = (a.y + b.y) / 2;
    const z = ((a.z ?? 0) + (b.z ?? 0)) / 2;
    symmetric[index] = { x: axisX + offset, y, z };
    symmetric[other] = { x: axisX - offset, y, z };
  }
  const asymmetryAfter = asymmetryOf(symmetric, axisX, faceWidth);
  if (asymmetryBefore > 0.4) {
    notes.push(
      `Left/right landmark disagreement of ${asymmetryBefore.toFixed(1)}% was mirror-averaged across ${pairedLandmarks} paired points.`
    );
  }
  // Judge pairing on the landmarks the measurements depend on. Counting the whole mesh would
  // fire on any source where many points happen to coincide, which says nothing about the face.
  const unpairedKeyPoints = KEY_PAIRS.filter(
    ([left, right]) => pairs[left] !== right || pairs[right] !== left
  );
  if (unpairedKeyPoints.length > KEY_PAIRS.length * 0.25) {
    notes.push(
      `${unpairedKeyPoints.length} of ${KEY_PAIRS.length} core feature pairs could not be mirror-matched; the face may be too turned or partly hidden.`
    );
  }

  const widthConfidence = ramp(pose.yawDegrees, MAX_CORRECTED_ANGLE, 55);
  const heightConfidence = ramp(pose.pitchDegrees, MAX_CORRECTED_ANGLE, 50);
  if (widthConfidence < 0.999) {
    notes.push(
      `Turn beyond ${MAX_CORRECTED_ANGLE}° cannot be undone from one image; width-driven sliders were held ${Math.round((1 - widthConfidence) * 100)}% toward neutral.`
    );
  }
  if (heightConfidence < 0.999) {
    notes.push(
      `Nod beyond ${MAX_CORRECTED_ANGLE}° cannot be undone from one image; height-driven sliders were held ${Math.round((1 - heightConfidence) * 100)}% toward neutral.`
    );
  }

  return {
    landmarks: fromMetric(symmetric, sourceAspectRatio),
    correction: {
      pose,
      straightenedDegrees: 0,
      asymmetryBefore,
      asymmetryAfter,
      widthConfidence,
      heightConfidence,
      pairedLandmarks,
      notes
    }
  };
}

/** Measurements whose value is a horizontal extent, so a residual head turn corrupts them. */
const widthDriven: MeasurementKey[] = [
  "faceAspect",
  "cheekWidth",
  "jawWidth",
  "chinWidth",
  "chinShape",
  "eyeWidth",
  "eyeSpacing",
  "browWidth",
  "noseWidth",
  "noseBridgeWidth",
  "noseTipWidth",
  "mouthWidth",
  "philtrumWidth"
];

/** Measurements whose value is a vertical extent, so a residual nod corrupts them. */
const heightDriven: MeasurementKey[] = [
  "faceAspect",
  "cheekHeight",
  "jawHeight",
  "lowerFace",
  "eyeVertical",
  "browHeight",
  "noseLength",
  "noseVertical",
  "noseRootHeight",
  "noseWingHeight",
  "mouthVertical",
  "upperLip",
  "lowerLip"
];

interface ExpressionRule {
  label: string;
  /** MediaPipe blendshape names. The strongest one in the group drives the rule. */
  shapes: string[];
  /** Below `dead` the expression is ordinary muscle tone; at `full` the measurement is lost. */
  dead: number;
  full: number;
  /** How much of the measurement this expression can destroy, 0-1. */
  targets: Partial<Record<MeasurementKey, number>>;
}

/**
 * Weights are deliberately coarse. They encode which measurement an expression physically moves
 * and roughly how completely, not a calibrated de-expression model -- FaceForge has no neutral
 * reference of the same person to solve one from. A weight of 1 means "this measurement tells us
 * nothing about the neutral face at full expression", so it fades entirely to the baseline.
 */
const expressionRules: ExpressionRule[] = [
  {
    label: "open mouth",
    shapes: ["jawOpen"],
    dead: 0.1,
    full: 0.55,
    targets: {
      mouthVertical: 1,
      lowerFace: 0.9,
      jawHeight: 0.8,
      faceAspect: 0.6,
      chinShape: 0.5,
      upperLip: 0.6,
      lowerLip: 0.6
    }
  },
  {
    label: "smile",
    shapes: ["mouthSmileLeft", "mouthSmileRight"],
    dead: 0.15,
    full: 0.6,
    targets: {
      mouthWidth: 1,
      mouthAngle: 1,
      philtrumWidth: 0.6,
      cheekWidth: 0.6,
      cheekHeight: 0.5,
      upperLip: 0.7,
      lowerLip: 0.7
    }
  },
  {
    label: "stretched mouth",
    shapes: ["mouthStretchLeft", "mouthStretchRight"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthWidth: 0.9, upperLip: 0.6, lowerLip: 0.6 }
  },
  {
    label: "frown",
    shapes: ["mouthFrownLeft", "mouthFrownRight"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthAngle: 1, mouthWidth: 0.5, lowerLip: 0.5 }
  },
  {
    label: "pursed lips",
    shapes: ["mouthPucker", "mouthFunnel"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthWidth: 1, philtrumWidth: 0.7, upperLip: 0.8, lowerLip: 0.8 }
  },
  {
    label: "compressed lips",
    shapes: ["mouthPressLeft", "mouthPressRight", "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower"],
    dead: 0.2,
    full: 0.7,
    targets: { upperLip: 0.9, lowerLip: 0.9, philtrumWidth: 0.4 }
  },
  {
    label: "raised lip",
    shapes: ["mouthUpperUpLeft", "mouthUpperUpRight", "mouthLowerDownLeft", "mouthLowerDownRight"],
    dead: 0.2,
    full: 0.7,
    targets: { upperLip: 0.7, lowerLip: 0.7, mouthVertical: 0.5 }
  },
  {
    label: "closed or narrowed eyes",
    shapes: ["eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight"],
    // Resting faces carry a little squint, so the dead zone is wider here than for the mouth.
    dead: 0.22,
    full: 0.6,
    targets: {
      eyeOpenness: 1,
      eyeInnerHeight: 0.9,
      eyeOuterHeight: 0.9,
      eyeVertical: 0.4
    }
  },
  {
    label: "widened eyes",
    shapes: ["eyeWideLeft", "eyeWideRight"],
    dead: 0.2,
    full: 0.7,
    targets: { eyeOpenness: 0.9, eyeInnerHeight: 0.7, eyeOuterHeight: 0.7 }
  },
  {
    label: "moved brows",
    shapes: ["browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
    // Brow blendshapes idle well above zero on a relaxed face; start later than the mouth rules.
    dead: 0.22,
    full: 0.65,
    targets: { browHeight: 1, browAngle: 1, browWidth: 0.5 }
  },
  {
    label: "raised cheeks",
    shapes: ["cheekSquintLeft", "cheekSquintRight", "cheekPuff"],
    dead: 0.2,
    full: 0.7,
    targets: { cheekWidth: 0.8, cheekHeight: 0.8, eyeOuterHeight: 0.5 }
  },
  {
    label: "wrinkled nose",
    shapes: ["noseSneerLeft", "noseSneerRight"],
    dead: 0.2,
    full: 0.7,
    targets: { noseWidth: 0.8, noseWingHeight: 0.7, noseTipWidth: 0.5 }
  },
  {
    label: "shifted jaw",
    shapes: ["jawLeft", "jawRight", "jawForward"],
    dead: 0.2,
    full: 0.7,
    targets: { jawWidth: 0.7, chinWidth: 0.7, chinShape: 0.7 }
  },
  {
    label: "tongue out",
    shapes: ["tongueOut"],
    dead: 0.1,
    full: 0.4,
    targets: { upperLip: 1, lowerLip: 1, mouthVertical: 1, mouthWidth: 0.6 }
  }
];

export interface MeasurementTrust {
  confidence: Record<MeasurementKey, number>;
  /** Human-readable causes, strongest first, for the ones that actually lost confidence. */
  reasons: string[];
}

/**
 * Combines residual pose error and detected expressions into a per-measurement trust score.
 * Contributions multiply, so a turned head pulling a smile loses more than either alone.
 */
export function measurementTrust(
  blendshapes: Readonly<Record<string, number>>,
  correction: Pick<AppliedCorrection, "widthConfidence" | "heightConfidence">,
  keys: readonly MeasurementKey[]
): MeasurementTrust {
  const confidence = Object.fromEntries(keys.map((key) => [key, 1])) as Record<
    MeasurementKey,
    number
  >;
  const apply = (key: MeasurementKey, factor: number) => {
    if (confidence[key] === undefined) return;
    confidence[key] = clamp(confidence[key] * factor, 0, 1);
  };

  for (const key of widthDriven) apply(key, correction.widthConfidence);
  for (const key of heightDriven) apply(key, correction.heightConfidence);

  const causes: Array<{ label: string; strength: number }> = [];
  for (const rule of expressionRules) {
    const score = Math.max(0, ...rule.shapes.map((shape) => blendshapes[shape] ?? 0));
    const strength = clamp((score - rule.dead) / (rule.full - rule.dead), 0, 1);
    if (strength <= 0) continue;
    causes.push({ label: rule.label, strength });
    for (const [rawKey, weight] of Object.entries(rule.targets)) {
      apply(rawKey as MeasurementKey, 1 - strength * (weight ?? 0));
    }
  }

  // The fade is continuous, but a note about a 2%-strength expression is noise, not information.
  const reasons = causes
    .filter((cause) => cause.strength >= 0.15)
    .sort((a, b) => b.strength - a.strength)
    .map(
      (cause) =>
        `Detected ${cause.label} at ${Math.round(cause.strength * 100)}% strength; the measurements it moves were faded toward neutral.`
    );

  return { confidence, reasons };
}
