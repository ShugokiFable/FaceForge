import type {
  FaceAnalysis,
  FaceLandmark,
  MeasurementKey
} from "./faceAnalysis";

export type ViewRole = "front" | "left" | "right";

export interface ImageQuality {
  score: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  faceCoverage: number;
  warnings: string[];
}

export interface ViewReport {
  role: ViewRole;
  detectedRole: ViewRole;
  yaw: number;
  quality: ImageQuality;
  score: number;
  used: boolean;
  warnings: string[];
}

export interface AnalyzedView {
  role: ViewRole;
  analysis: FaceAnalysis;
  report: ViewReport;
}

export interface MultiViewResult {
  analysis: FaceAnalysis;
  confidence: number;
  reports: ViewReport[];
}

export interface VideoCandidate<T> {
  value: T;
  yaw: number;
  quality: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function signedYawOffset(
  landmarks: readonly FaceLandmark[],
  sourceAspectRatio: number
): number {
  const nose = landmarks[1];
  const left = landmarks[234];
  const right = landmarks[454];
  if (!nose || !left || !right) return 0;
  const width = Math.abs(right.x - left.x) * sourceAspectRatio;
  return width > 0
    ? ((nose.x - (left.x + right.x) / 2) * sourceAspectRatio) / width
    : 0;
}

export function measureImageQuality(
  image: CanvasImageSource,
  width: number,
  height: number,
  landmarks: readonly FaceLandmark[]
): ImageQuality {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      score: 0.5,
      brightness: 0.5,
      contrast: 0.5,
      sharpness: 0.5,
      faceCoverage: 0,
      warnings: ["Image quality sampling was unavailable."]
    };
  }
  context.drawImage(image, 0, 0, width, height, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const gray = new Float32Array(size * size);
  let sum = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value =
      (pixels[offset] * 0.2126 +
        pixels[offset + 1] * 0.7152 +
        pixels[offset + 2] * 0.0722) /
      255;
    gray[index] = value;
    sum += value;
  }
  const brightness = sum / gray.length;
  let variance = 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const index = y * size + x;
      variance += (gray[index] - brightness) ** 2;
      edgeTotal +=
        Math.abs(gray[index] - gray[index - 1]) +
        Math.abs(gray[index] - gray[index - size]);
      edgeCount += 2;
    }
  }
  const contrast = Math.sqrt(variance / ((size - 1) * (size - 1)));
  const sharpness = edgeCount > 0 ? edgeTotal / edgeCount : 0;
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const faceCoverage =
    xs.length > 0
      ? (Math.max(...xs) - Math.min(...xs)) *
        (Math.max(...ys) - Math.min(...ys))
      : 0;
  const warnings: string[] = [];
  if (brightness < 0.18) warnings.push("Image is too dark.");
  if (brightness > 0.88) warnings.push("Image is overexposed.");
  if (contrast < 0.09) warnings.push("Image has very low contrast.");
  if (sharpness < 0.035) warnings.push("Image may be blurred.");
  if (faceCoverage < 0.07) warnings.push("Face is too small in the frame.");
  const exposureScore = clamp01(1 - Math.abs(brightness - 0.52) / 0.5);
  const score = clamp01(
    exposureScore * 0.25 +
      clamp01(contrast / 0.22) * 0.2 +
      clamp01(sharpness / 0.09) * 0.35 +
      clamp01(faceCoverage / 0.2) * 0.2
  );
  return { score, brightness, contrast, sharpness, faceCoverage, warnings };
}

export function assessView(
  role: ViewRole,
  analysis: FaceAnalysis,
  landmarks: readonly FaceLandmark[],
  quality: ImageQuality
): ViewReport {
  const yaw = signedYawOffset(landmarks, analysis.sourceAspectRatio);
  const magnitude = Math.abs(yaw);
  const detectedRole: ViewRole =
    magnitude < 0.025 ? "front" : yaw < 0 ? "left" : "right";
  const poseScore =
    role === "front"
      ? clamp01(1 - magnitude / 0.07)
      : clamp01(1 - Math.abs(magnitude - 0.085) / 0.09);
  const warnings = [...quality.warnings];
  if (role === "front" && magnitude > 0.055)
    warnings.push("Front view is turned too far.");
  if (role !== "front" && magnitude < 0.025)
    warnings.push("Angled view is too frontal to add profile evidence.");
  if (role !== "front" && magnitude > 0.2)
    warnings.push("Angled view is too close to a full profile.");
  if (role !== "front" && detectedRole !== role && detectedRole !== "front")
    warnings.push("This image reads as the opposite side; it was relabeled automatically.");
  const score = clamp01(quality.score * 0.62 + poseScore * 0.38);
  return {
    role,
    detectedRole,
    yaw,
    quality,
    score,
    used:
      role === "front" ||
      (score >= 0.42 && magnitude >= 0.025 && magnitude <= 0.2),
    warnings
  };
}

const angleMeasurements = new Set<MeasurementKey>([
  "cheekHeight",
  "jawHeight",
  "lowerFace",
  "eyeVertical",
  "browHeight",
  "noseLength",
  "noseVertical",
  "noseRootHeight",
  "noseWingHeight",
  "mouthVertical"
]);

export function fuseFaceAnalyses(views: readonly AnalyzedView[]): MultiViewResult {
  const front = views.find((view) => view.role === "front");
  if (!front) throw new Error("A front view is required.");
  const accepted = views.filter(
    (view) => view.role === "front" || view.report.used
  );
  const measurements = Object.fromEntries(
    Object.entries(front.analysis.measurements).map(([rawKey, measurement]) => {
      const key = rawKey as MeasurementKey;
      if (!angleMeasurements.has(key)) return [key, measurement];
      let weighted = measurement.value;
      let weight = 1;
      for (const view of accepted) {
        if (view.role === "front") continue;
        const candidate = view.analysis.measurements[key].value;
        const deviation = Math.abs(candidate - measurement.value) /
          Math.max(Math.abs(measurement.value), 0.001);
        if (deviation > 0.18) continue;
        const sideWeight = view.report.score * 0.35;
        weighted += candidate * sideWeight;
        weight += sideWeight;
      }
      const value = weighted / weight;
      return [key, { ...measurement, value, display: value.toFixed(3) }];
    })
  ) as FaceAnalysis["measurements"];
  const sideCount = accepted.filter((view) => view.role !== "front").length;
  const confidence = clamp01(
    0.62 +
      front.report.quality.score * 0.14 +
      sideCount * 0.1
  );
  const reports = views.map((view) => view.report);
  return {
    analysis: {
      ...front.analysis,
      measurements,
      warnings: [
        ...front.analysis.warnings,
        ...reports.flatMap((report) =>
          report.warnings.map((warning) => `${report.role}: ${warning}`)
        ),
        sideCount > 0
          ? `Multi-view fusion used ${sideCount + 1} views at ${Math.round(
              confidence * 100
            )}% source confidence.`
          : "No angled view passed quality and pose checks; front view only was used."
      ]
    },
    confidence,
    reports
  };
}

export function selectVideoViews<T>(
  candidates: readonly VideoCandidate<T>[]
): Partial<Record<ViewRole, VideoCandidate<T>>> {
  const best = (
    predicate: (candidate: VideoCandidate<T>) => boolean,
    score: (candidate: VideoCandidate<T>) => number
  ) =>
    candidates
      .filter(predicate)
      .reduce<VideoCandidate<T> | undefined>(
        (winner, candidate) =>
          !winner || score(candidate) > score(winner) ? candidate : winner,
        undefined
      );
  const front = best(
    () => true,
    (candidate) => candidate.quality - Math.abs(candidate.yaw) * 5
  );
  return {
    front,
    left: best(
      (candidate) =>
        candidate !== front &&
        candidate.yaw <= -0.025 &&
        candidate.yaw >= -0.2,
      (candidate) =>
        candidate.quality - Math.abs(Math.abs(candidate.yaw) - 0.085) * 4
    ),
    right: best(
      (candidate) =>
        candidate !== front &&
        candidate.yaw >= 0.025 &&
        candidate.yaw <= 0.2,
      (candidate) =>
        candidate.quality - Math.abs(candidate.yaw - 0.085) * 4
    )
  };
}
