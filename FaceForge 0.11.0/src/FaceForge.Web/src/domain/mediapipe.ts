import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark
} from "@mediapipe/tasks-vision";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

const createLandmarker = async (): Promise<FaceLandmarker> => {
  const wasmRoot = new URL("./mediapipe/wasm/", window.location.href).href;
  const modelPath = new URL(
    "./mediapipe/models/face_landmarker.task",
    window.location.href
  ).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
  const common = {
    runningMode: "IMAGE" as const,
    numFaces: 2,
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
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
  landmarkerPromise ??= createLandmarker();
  return landmarkerPromise;
};

export async function analyzePortrait(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<FaceLandmarkerResult> {
  const landmarker = await getFaceLandmarker();
  return landmarker.detect(image);
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
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const original = await analyzePortrait(image);
  const fallback: UprightAnalysis = {
    result: original,
    original,
    width,
    height,
    straightenedDegrees: 0,
    zoomFactor: 1
  };
  if (original.faceLandmarks.length !== 1 || width <= 0 || height <= 0) return fallback;

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
  context.drawImage(image, -cropCenterX, -cropCenterY, width, height);

  const refined = await analyzePortrait(canvas);
  if (refined.faceLandmarks.length !== 1) return fallback;

  return {
    result: refined,
    original,
    width: canvas.width,
    height: canvas.height,
    straightenedDegrees: needsStraightening ? -roll : 0,
    zoomFactor: needsReframing && extent ? Math.min(4, REFRAME_THRESHOLD / extent.width) : 1
  };
}

export function blendshapeMap(result: FaceLandmarkerResult): Record<string, number> {
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  return Object.fromEntries(categories.map((category) => [category.categoryName, category.score]));
}

export type { FaceLandmarkerResult, NormalizedLandmark };
