import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark
} from "@mediapipe/tasks-vision";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let lenientLandmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * `numFaces` is deliberately generous. A group shot or a photo with a face on a poster behind the
 * subject used to fail outright; the caller now picks the best candidate instead.
 */
const createLandmarker = async (confidence: number): Promise<FaceLandmarker> => {
  const wasmRoot = new URL("./mediapipe/wasm/", window.location.href).href;
  const modelPath = new URL(
    "./mediapipe/models/face_landmarker.task",
    window.location.href
  ).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
  const common = {
    runningMode: "IMAGE" as const,
    numFaces: 5,
    minFaceDetectionConfidence: confidence,
    minFacePresenceConfidence: confidence,
    minTrackingConfidence: confidence,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  };

  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      ...common,
      baseOptions: { modelAssetPath: modelPath, delegate: "GPU" }
    });
  } catch {
    return FaceLandmarker.createFromOptions(fileset, {
      ...common,
      baseOptions: { modelAssetPath: modelPath, delegate: "CPU" }
    });
  }
};

export const getFaceLandmarker = (): Promise<FaceLandmarker> => {
  landmarkerPromise ??= createLandmarker(0.6);
  return landmarkerPromise;
};

/**
 * A second detector at a much lower threshold, built only when the normal one finds nothing.
 * Thresholds are fixed at construction, so a lenient retry needs its own instance.
 */
const getLenientLandmarker = (): Promise<FaceLandmarker> => {
  lenientLandmarkerPromise ??= createLandmarker(0.2);
  return lenientLandmarkerPromise;
};

export async function analyzePortrait(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<FaceLandmarkerResult> {
  const landmarker = await getFaceLandmarker();
  return landmarker.detect(image);
}

const sizeOf = (image: HTMLImageElement | HTMLCanvasElement) =>
  image instanceof HTMLImageElement
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };

/** Draws the source into a new canvas, optionally rotated by a right angle and auto-levelled. */
const transform = (
  image: HTMLImageElement | HTMLCanvasElement,
  degrees: number,
  autoLevel: boolean
): HTMLCanvasElement | null => {
  const { width, height } = sizeOf(image);
  if (width <= 0 || height <= 0) return null;
  const quarterTurn = Math.abs(degrees % 180) === 90;
  const canvas = document.createElement("canvas");
  canvas.width = quarterTurn ? height : width;
  canvas.height = quarterTurn ? width : height;
  const context = canvas.getContext("2d", { willReadFrequently: autoLevel });
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  if (degrees !== 0) context.rotate((degrees * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  if (!autoLevel) return canvas;

  // Stretch the luminance histogram between its 2nd and 98th percentiles. Underexposed,
  // washed-out and flat-lit photographs are the common detection failures, and the model sees
  // contrast rather than absolute brightness.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const luminance =
      (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) | 0;
    histogram[luminance] += 1;
  }
  const total = data.length / 4;
  const cut = total * 0.02;
  let low = 0;
  let high = 255;
  for (let running = 0, value = 0; value < 256; value += 1) {
    running += histogram[value];
    if (running >= cut) {
      low = value;
      break;
    }
  }
  for (let running = 0, value = 255; value >= 0; value -= 1) {
    running += histogram[value];
    if (running >= cut) {
      high = value;
      break;
    }
  }
  if (high - low < 8) return canvas;
  const scale = 255 / (high - low);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.max(0, Math.min(255, (data[index] - low) * scale));
    data[index + 1] = Math.max(0, Math.min(255, (data[index + 1] - low) * scale));
    data[index + 2] = Math.max(0, Math.min(255, (data[index + 2] - low) * scale));
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};

export interface DetectionAttempt {
  result: FaceLandmarkerResult;
  /** The image the successful detection ran on: the original, or a transformed copy. */
  image: HTMLImageElement | HTMLCanvasElement;
  /** Plain-language description of what had to be done, empty when the source worked as-is. */
  strategy: string;
  /** Faces found before the best one was picked. */
  candidates: number;
}

/**
 * Escalating detection. Every step past the first is a real failure mode seen on ordinary photos:
 * a phone picture saved with a rotation the browser did not apply, an underexposed or flat-lit
 * shot, and a face the model only just declines at the default threshold.
 *
 * The ladder stops at the first step that finds a face, so a clean portrait still costs exactly
 * one detection.
 */
export async function detectFaceRobustly(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<DetectionAttempt | null> {
  const strict = await getFaceLandmarker();

  const direct = strict.detect(image);
  if (direct.faceLandmarks.length > 0) {
    return { result: direct, image, strategy: "", candidates: direct.faceLandmarks.length };
  }

  const passes: Array<{ degrees: number; autoLevel: boolean; strategy: string }> = [
    { degrees: 0, autoLevel: true, strategy: "after auto-levelling the exposure" },
    { degrees: 90, autoLevel: false, strategy: "after rotating the image 90° clockwise" },
    { degrees: -90, autoLevel: false, strategy: "after rotating the image 90° anticlockwise" },
    { degrees: 180, autoLevel: false, strategy: "after turning the image upside down" },
    { degrees: 90, autoLevel: true, strategy: "after rotating 90° clockwise and auto-levelling" },
    {
      degrees: -90,
      autoLevel: true,
      strategy: "after rotating 90° anticlockwise and auto-levelling"
    }
  ];

  for (const pass of passes) {
    const canvas = transform(image, pass.degrees, pass.autoLevel);
    if (!canvas) continue;
    const attempt = strict.detect(canvas);
    if (attempt.faceLandmarks.length > 0) {
      return {
        result: attempt,
        image: canvas,
        strategy: pass.strategy,
        candidates: attempt.faceLandmarks.length
      };
    }
  }

  // Last resort: the same ladder at a much lower detection threshold. A face found only here is
  // real but weakly detected, so the caller should expect lower measurement quality.
  const lenient = await getLenientLandmarker();
  const lenientPasses: Array<{ degrees: number; autoLevel: boolean; strategy: string }> = [
    { degrees: 0, autoLevel: false, strategy: "at a reduced detection threshold" },
    { degrees: 0, autoLevel: true, strategy: "at a reduced threshold after auto-levelling" },
    { degrees: 90, autoLevel: true, strategy: "at a reduced threshold, rotated 90° clockwise" },
    {
      degrees: -90,
      autoLevel: true,
      strategy: "at a reduced threshold, rotated 90° anticlockwise"
    }
  ];
  for (const pass of lenientPasses) {
    const candidate =
      pass.degrees === 0 && !pass.autoLevel ? image : transform(image, pass.degrees, pass.autoLevel);
    if (!candidate) continue;
    const attempt = lenient.detect(candidate);
    if (attempt.faceLandmarks.length > 0) {
      return {
        result: attempt,
        image: candidate,
        strategy: pass.strategy,
        candidates: attempt.faceLandmarks.length
      };
    }
  }

  return null;
}

/**
 * Picks the subject from a multi-face detection: biggest wins, with a nudge toward the middle of
 * the frame. Refusing to choose is worse than choosing -- a portrait with a face on a poster in
 * the background is a normal photograph, not a user error.
 */
export function selectPrimaryFace(result: FaceLandmarkerResult): number {
  if (result.faceLandmarks.length <= 1) return 0;
  let best = 0;
  let bestScore = -Infinity;
  result.faceLandmarks.forEach((points, index) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    const centreOffset = Math.hypot((minX + maxX) / 2 - 0.5, (minY + maxY) / 2 - 0.5);
    const score = area * (1 - centreOffset * 0.35);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

/** Reorders a detection so the chosen face is first, keeping blendshapes aligned with it. */
export function withPrimaryFaceFirst(
  result: FaceLandmarkerResult,
  index: number
): FaceLandmarkerResult {
  if (index === 0) return result;
  const reorder = <T,>(items: T[] | undefined): T[] => {
    if (!items || items.length <= index) return items ?? [];
    return [items[index], ...items.filter((_, position) => position !== index)];
  };
  return {
    ...result,
    faceLandmarks: reorder(result.faceLandmarks),
    faceBlendshapes: reorder(result.faceBlendshapes),
    facialTransformationMatrixes: reorder(result.facialTransformationMatrixes)
  };
}

export interface UprightAnalysis {
  /** The detection to measure from: the second, normalized pass when one was worth running. */
  result: FaceLandmarkerResult;
  /** The first pass on the untouched image, used for the landmark overlay on the photo. */
  original: FaceLandmarkerResult;
  /** Pixel dimensions of whatever `result` was detected on. */
  width: number;
  height: number;
  /** How far the image was rotated before the second pass, in degrees. */
  straightenedDegrees: number;
  /** How much the face was magnified by cropping to it, 1 when no crop was applied. */
  zoomFactor: number;
  /** What the detection ladder had to do to find the face; empty when the source worked as-is. */
  recoveryStrategy: string;
  /** Faces the detector found before the subject was chosen. */
  candidateFaces: number;
}

const rollDegreesOf = (result: FaceLandmarkerResult, aspect: number): number => {
  const points = result.faceLandmarks[0];
  const left = points?.[33];
  const right = points?.[263];
  if (!left || !right) return 0;
  return (
    Math.atan2(right.y - left.y, (right.x - left.x) * aspect) * (180 / Math.PI)
  );
};

/** Below this a second pass costs more than the landmark shift it would recover. */
const STRAIGHTEN_THRESHOLD_DEGREES = 4;

/**
 * The landmark model works on a fixed-size internal crop, so a face occupying a small part of a
 * wide photo is measured from far fewer pixels than one that fills the frame. Re-detecting below
 * this share of the frame width recovers that lost precision.
 */
const REFRAME_THRESHOLD = 0.55;

/** Face width as a fraction of the whole frame, plus the face centre, in normalized units. */
const faceExtentOf = (
  result: FaceLandmarkerResult
): { centerX: number; centerY: number; width: number; height: number } | null => {
  const points = result.faceLandmarks[0];
  if (!points || points.length < 455) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY
  };
};

/**
 * Normalizes the source before the detection that actually gets measured, in one canvas pass.
 *
 *  - **Straighten.** Landmark detection is not rotation invariant: the same face photographed at
 *    a tilt lands its soft features -- brows especially -- in measurably different places.
 *    De-rotating the landmarks afterwards fixes the geometry but not the model's own error.
 *    Measured on the QA portrait at a 16 degree tilt, this is the difference between a 0.58 and a
 *    0.15 worst-case slider drift.
 *
 *  - **Reframe.** The model resizes its input to a fixed internal resolution, so a small face in
 *    a wide shot is landmarked from far fewer pixels. Cropping to the face and re-detecting gives
 *    the model the resolution it would have had from a tight portrait.
 *
 * Either step alone justifies the second pass, and doing both at once costs no more than one.
 * If the transformed image loses the face, the original detection is kept.
 */
export async function analyzePortraitUpright(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<UprightAnalysis> {
  // The ladder may hand back a rotated or auto-levelled copy; everything downstream measures
  // that image, so its dimensions -- not the original's -- define the working frame.
  const attempt = await detectFaceRobustly(image);
  if (!attempt) {
    const empty = await analyzePortrait(image);
    const { width: rawWidth, height: rawHeight } = sizeOf(image);
    return {
      result: empty,
      original: empty,
      width: rawWidth,
      height: rawHeight,
      straightenedDegrees: 0,
      zoomFactor: 1,
      recoveryStrategy: "",
      candidateFaces: 0
    };
  }

  const source = attempt.image;
  const { width, height } = sizeOf(source);
  const original = withPrimaryFaceFirst(attempt.result, selectPrimaryFace(attempt.result));
  const fallback: UprightAnalysis = {
    result: original,
    original,
    width,
    height,
    straightenedDegrees: 0,
    zoomFactor: 1,
    recoveryStrategy: attempt.strategy,
    candidateFaces: attempt.candidates
  };
  if (width <= 0 || height <= 0) return fallback;

  const roll = rollDegreesOf(original, width / height);
  const extent = faceExtentOf(original);
  const needsStraightening =
    Number.isFinite(roll) && Math.abs(roll) >= STRAIGHTEN_THRESHOLD_DEGREES;
  const needsReframing = extent !== null && extent.width < REFRAME_THRESHOLD;
  if (!needsStraightening && !needsReframing) return fallback;

  const angle = needsStraightening ? (-roll * Math.PI) / 180 : 0;
  // Source rectangle in pixels: the face plus generous margin, or the whole frame when only
  // straightening is needed. Margin keeps the jaw and hairline in shot after rotation.
  const margin = 0.55;
  const cropWidth = needsReframing
    ? Math.min(width, extent!.width * (1 + margin * 2) * width)
    : width;
  const cropHeight = needsReframing
    ? Math.min(height, extent!.height * (1 + margin * 2) * height)
    : height;
  const cropCenterX = needsReframing ? extent!.centerX * width : width / 2;
  const cropCenterY = needsReframing ? extent!.centerY * height : height / 2;

  // Re-render the crop at the model's benefit rather than the source's framing.
  const targetLongEdge = 1024;
  const scale = needsReframing
    ? Math.min(4, targetLongEdge / Math.max(cropWidth, cropHeight))
    : 1;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((cropWidth * cos + cropHeight * sin) * scale));
  canvas.height = Math.max(1, Math.round((cropHeight * cos + cropWidth * sin) * scale));
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle);
  context.scale(scale, scale);
  context.drawImage(source, -cropCenterX, -cropCenterY, width, height);

  const refinedRaw = await analyzePortrait(canvas);
  if (refinedRaw.faceLandmarks.length === 0) return fallback;
  const refined = withPrimaryFaceFirst(refinedRaw, selectPrimaryFace(refinedRaw));

  return {
    result: refined,
    original,
    width: canvas.width,
    height: canvas.height,
    straightenedDegrees: needsStraightening ? -roll : 0,
    zoomFactor: needsReframing && extent ? Math.min(4, REFRAME_THRESHOLD / extent.width) : 1,
    recoveryStrategy: attempt.strategy,
    candidateFaces: attempt.candidates
  };
}

export function blendshapeMap(result: FaceLandmarkerResult): Record<string, number> {
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  return Object.fromEntries(categories.map((category) => [category.categoryName, category.score]));
}

export type { FaceLandmarkerResult, NormalizedLandmark };
