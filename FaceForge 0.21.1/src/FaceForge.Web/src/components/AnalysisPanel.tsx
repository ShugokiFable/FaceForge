import type { FaceAnalysis, FaceLandmark } from "../domain/faceAnalysis";
import type { StyleAssessment } from "../domain/imageStyle";
import DiagnosticFace from "./DiagnosticFace";
import { InfoIcon } from "./Icons";

interface AnalysisPanelProps {
  landmarks: readonly FaceLandmark[] | null;
  analysis: FaceAnalysis | null;
  styleAssessment: StyleAssessment | null;
  error: string | null;
}

const pct = (value: number) => `${Math.round(value)}%`;
const deg = (value: number) => `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(1)}°`;

const trustLabel = (confidence: number, axis: string) =>
  confidence >= 0.999
    ? "fully recovered"
    : `${axis} ${Math.round(confidence * 100)}% trusted`;

export default function AnalysisPanel({
  landmarks,
  analysis,
  styleAssessment,
  error
}: AnalysisPanelProps) {
  const m = analysis?.measurements;
  // Anything below a third trust contributed almost nothing; naming them is more useful than a
  // score, because the user can decide to reshoot for exactly those features.
  const held = analysis
    ? Object.entries(analysis.trust)
        .filter(([, confidence]) => confidence < 0.35)
        .map(([key]) => analysis.measurements[key as keyof typeof analysis.trust].label.toLowerCase())
    : [];
  return (
    <section className="workspace-panel analysis-panel">
      <div className="panel-heading">
        <span className="step-number">2</span>
        <h2>Analysis &amp; proportions</h2>
      </div>
      <DiagnosticFace landmarks={landmarks} analysis={analysis} />
      <div className="analysis-summary">
        <h3>Analysis summary</h3>
        {error ? (
          <div className="error-message">{error}</div>
        ) : analysis && m ? (
          <>
            <div className="summary-grid">
              <div><span>Face height / width</span><strong>{m.faceAspect.display}</strong></div>
              <div><span>Jaw width</span><strong>{m.jawWidth.display}</strong></div>
              <div><span>Eye spacing</span><strong>{m.eyeSpacing.display}</strong></div>
              <div><span>Nose width</span><strong>{m.noseWidth.display}</strong></div>
              <div><span>Mouth width</span><strong>{m.mouthWidth.display}</strong></div>
              <div><span>Residual asymmetry</span><strong>{pct(analysis.symmetry)}</strong></div>
              <div>
                <span>Interpretation</span>
                <strong>{styleAssessment?.kind === "stylized" ? "realism-normalized art" : "photograph"}</strong>
              </div>
            </div>
            <div className="pose-correction">
              <h4>Source correction</h4>
              <div className="pose-grid">
                <div>
                  <span>Tilt</span>
                  <strong>
                    {deg(
                      analysis.correction.pose.rollDegrees -
                        analysis.correction.straightenedDegrees
                    )}
                  </strong>
                  <small>
                    {analysis.correction.straightenedDegrees === 0
                      ? "rotated out"
                      : "straightened, then rotated out"}
                  </small>
                </div>
                <div>
                  <span>Turn</span>
                  <strong>{deg(analysis.correction.pose.yawDegrees)}</strong>
                  <small>{trustLabel(analysis.correction.widthConfidence, "widths")}</small>
                </div>
                <div>
                  <span>Nod</span>
                  <strong>{deg(analysis.correction.pose.pitchDegrees)}</strong>
                  <small>{trustLabel(analysis.correction.heightConfidence, "heights")}</small>
                </div>
                <div>
                  <span>Mirrored</span>
                  <strong>{analysis.correction.pairedLandmarks}</strong>
                  <small>paired points averaged</small>
                </div>
              </div>
              {held.length > 0 && (
                <div className="held-measurements">
                  <strong>Left at neutral ({held.length})</strong>
                  <span>{held.join(", ")}</span>
                </div>
              )}
            </div>
            {analysis.warnings.length > 0 && (
              <ul className="warning-list">
                {analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </>
        ) : (
          <div className="empty-summary">
            Choose a portrait and run analysis to measure the visible facial proportions.
          </div>
        )}
      </div>
      <div className="analysis-footnote">
        <InfoIcon />
        <span>
          Race ranking and sliders use many proportions together; symmetry is only a quality
          signal and never the face-conversion target.
        </span>
      </div>
    </section>
  );
}
