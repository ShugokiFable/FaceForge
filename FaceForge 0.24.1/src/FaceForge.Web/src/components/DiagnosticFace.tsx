import { useMemo } from "react";
import {
  projectLandmarksForDiagnostic,
  type FaceAnalysis,
  type FaceLandmark
} from "../domain/faceAnalysis";

interface DiagnosticFaceProps {
  landmarks: readonly FaceLandmark[] | null;
  analysis: FaceAnalysis | null;
}

const lineSets = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [70, 63, 105, 66, 107],
  [336, 296, 334, 293, 300],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [98, 97, 2, 326, 327],
  [61, 0, 291, 17, 61],
  [61, 13, 291, 14, 61]
] as const;

const value = (analysis: FaceAnalysis | null, key: keyof FaceAnalysis["measurements"]) =>
  analysis?.measurements[key].display ?? "—";

export default function DiagnosticFace({ landmarks, analysis }: DiagnosticFaceProps) {
  const displayLandmarks = useMemo(
    () =>
      landmarks && analysis
        ? projectLandmarksForDiagnostic(landmarks, analysis)
        : null,
    [landmarks, analysis]
  );
  const guideAspect = Math.max(
    1.2,
    Math.min(1.55, analysis?.measurements.faceAspect.value ?? 1.34)
  );
  const toPoint = (index: number) => {
    if (!displayLandmarks) return { x: 250, y: 300 };
    return displayLandmarks[index];
  };

  return (
    <div className="diagnostic-wrap">
      <svg
        viewBox="0 0 500 590"
        className="diagnostic-face"
        role="img"
        aria-label="Face proportion diagnostic"
      >
        <defs>
          <radialGradient id="faceGlow" cx="50%" cy="42%" r="55%">
            <stop offset="0%" stopColor="#263541" />
            <stop offset="100%" stopColor="#151d24" />
          </radialGradient>
        </defs>
        <ellipse
          cx="250"
          cy="286"
          rx="160"
          ry={160 * guideAspect}
          fill="url(#faceGlow)"
          opacity=".78"
        />
        {Array.from({ length: 8 }, (_, index) => (
          <ellipse
            key={`grid-${index}`}
            cx="250"
            cy="286"
            rx={36 + index * 17}
            ry={(36 + index * 17) * guideAspect}
            fill="none"
            stroke="#6d82911c"
          />
        ))}
        <g className="diagnostic-mesh">
          {displayLandmarks
            ? lineSets.map((line, index) => (
                <polyline
                  key={index}
                  points={line.map((pointIndex) => {
                    const p = toPoint(pointIndex);
                    return `${p.x},${p.y}`;
                  }).join(" ")}
                  fill="none"
                />
              ))
            : (
              <>
                <ellipse cx="250" cy="286" rx="135" ry={135 * guideAspect} />
                <path d="M160 245c28-22 55-22 82 0M258 245c28-22 55-22 82 0" />
                <path d="M250 230v115c-16 8-12 23 0 25 13 2 25-2 32-8" />
                <path d="M195 405c35 18 75 18 110 0" />
              </>
            )}
        </g>
        <g className="measure-guides">
          <path d="M102 52h296M102 45v14M398 45v14" />
          <path d="M72 72v438M65 72h14M65 510h14" />
          <path d="M250 62v470" strokeDasharray="5 6" />
          <path d="M118 242h264M118 365h264" strokeDasharray="5 6" />
        </g>
        <g className="measure-copy">
          <text x="250" y="25" textAnchor="middle">face H/W {value(analysis, "faceAspect")}</text>
          <text x="84" y="235" textAnchor="end">eye spacing</text>
          <text x="84" y="254" textAnchor="end">{value(analysis, "eyeSpacing")}</text>
          <text x="415" y="355">nose width</text>
          <text x="415" y="374">{value(analysis, "noseWidth")}</text>
          <text x="250" y="565" textAnchor="middle">jaw {value(analysis, "jawWidth")} · mouth {value(analysis, "mouthWidth")}</text>
        </g>
      </svg>
    </div>
  );
}
