import { useRef } from "react";
import type { FaceLandmark } from "../domain/faceAnalysis";
import type { SourceMode, StyleAssessment } from "../domain/imageStyle";
import type { ViewReport, ViewRole } from "../domain/multiView";
import { FolderIcon, InfoIcon, ScanIcon } from "./Icons";
import PortraitCanvas from "./PortraitCanvas";

interface SourcePanelProps {
  photoName: string | null;
  photoUrl: string | null;
  sideViews: Partial<
    Record<Exclude<ViewRole, "front">, { name: string; url: string }>
  >;
  captureMode: "single" | "guided";
  landmarks: readonly FaceLandmark[] | null;
  sourceMode: SourceMode;
  styleAssessment: StyleAssessment | null;
  viewReports: ViewReport[];
  multiViewConfidence: number | null;
  videoProgress: string | null;
  canAnalyze: boolean;
  isAnalyzing: boolean;
  canRefine: boolean;
  isRefining: boolean;
  onChooseView: (role: ViewRole, file: File) => void;
  onChooseTurnVideo: (file: File) => void;
  onCaptureModeChange: (mode: "single" | "guided") => void;
  onSourceModeChange: (mode: SourceMode) => void;
  onAnalyze: () => void;
  onRefine: () => void;
  onImageReady: (image: HTMLImageElement | null) => void;
}

const roleLabel: Record<ViewRole, string> = {
  front: "Front",
  left: "Left angle",
  right: "Right angle"
};

export default function SourcePanel({
  photoName,
  photoUrl,
  sideViews,
  captureMode,
  landmarks,
  sourceMode,
  styleAssessment,
  viewReports,
  multiViewConfidence,
  videoProgress,
  canAnalyze,
  isAnalyzing,
  canRefine,
  isRefining,
  onChooseView,
  onChooseTurnVideo,
  onCaptureModeChange,
  onSourceModeChange,
  onAnalyze,
  onRefine,
  onImageReady
}: SourcePanelProps) {
  const frontInput = useRef<HTMLInputElement>(null);
  const leftInput = useRef<HTMLInputElement>(null);
  const rightInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const inputs = { front: frontInput, left: leftInput, right: rightInput };

  return (
    <section className="workspace-panel source-panel">
      <div className="panel-heading">
        <span className="step-number">1</span>
        <h2>Source face</h2>
      </div>
      <p className="panel-intro">
        Use one front image, or add left/right angles for a more reliable estimate.
      </p>
      <div className="capture-mode-picker" role="group" aria-label="Capture workflow">
        <button
          type="button"
          className={captureMode === "single" ? "active" : ""}
          onClick={() => onCaptureModeChange("single")}
        >
          Quick photo
        </button>
        <button
          type="button"
          className={captureMode === "guided" ? "active" : ""}
          onClick={() => onCaptureModeChange("guided")}
        >
          Guided multi-view
        </button>
      </div>
      <div className="source-mode-picker" role="group" aria-label="Source image type">
        {([
          ["auto", "Auto"],
          ["photograph", "Photo"],
          ["stylized", "Anime / art"]
        ] as const).map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            className={sourceMode === mode ? "active" : ""}
            onClick={() => onSourceModeChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {captureMode === "guided" && (
        <>
          <div className="view-slots">
            {(["front", "left", "right"] as const).map((role) => {
              const url = role === "front" ? photoUrl : sideViews[role]?.url;
              const report = viewReports.find((item) => item.role === role);
              return (
                <button
                  type="button"
                  className={`view-slot ${report ? (report.used ? "used" : "ignored") : ""}`}
                  key={role}
                  onClick={() => inputs[role].current?.click()}
                  aria-label={`Choose ${roleLabel[role]} image`}
                >
                  {url ? <img src={url} alt="" /> : <FolderIcon />}
                  <strong>{roleLabel[role]}</strong>
                  <small>
                    {report
                      ? `${report.used ? "Used" : "Ignored"} · ${Math.round(
                          report.quality.score * 100
                        )}% quality`
                      : role === "front"
                        ? "Required"
                        : "Optional"}
                  </small>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="video-picker-button"
            onClick={() => videoInput.current?.click()}
            disabled={isAnalyzing}
          >
            <ScanIcon />
            {videoProgress ?? "Use a slow turn video instead"}
          </button>
          {multiViewConfidence !== null && (
            <div className="multi-view-confidence">
              Combined source confidence: {Math.round(multiViewConfidence * 100)}%
            </div>
          )}
        </>
      )}
      <div className="portrait-frame">
        <PortraitCanvas
          photoUrl={photoUrl}
          landmarks={landmarks}
          onImageReady={onImageReady}
        />
        {photoName && <div className="photo-name">{photoName}</div>}
      </div>
      {(["front", "left", "right"] as const).map((role) => (
        <input
          key={role}
          ref={inputs[role]}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChooseView(role, file);
            event.currentTarget.value = "";
          }}
        />
      ))}
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChooseTurnVideo(file);
          event.currentTarget.value = "";
        }}
      />
      <div className="source-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => frontInput.current?.click()}
        >
          <FolderIcon />
          Choose front
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onAnalyze}
          disabled={!canAnalyze || isAnalyzing}
        >
          <ScanIcon />
          {isAnalyzing
            ? "Analyzing…"
            : captureMode === "guided"
              ? "Analyze face set"
              : "Analyze face"}
        </button>
      </div>
      <button
        type="button"
        className="vision-refine-button"
        onClick={onRefine}
        disabled={!canRefine || isRefining}
        title="Optional: send the prepared front portrait to the configured vision account"
      >
        <ScanIcon />
        {isRefining ? "Refining with vision…" : "Refine front with vision model"}
      </button>
      {styleAssessment && (
        <div className={`style-assessment ${styleAssessment.kind}`}>
          <strong>
            {styleAssessment.kind === "stylized"
              ? "Stylized interpretation"
              : "Photographic interpretation"}
          </strong>
          <span>
            {Math.round(styleAssessment.confidence * 100)}% {styleAssessment.method} confidence
            {styleAssessment.kind === "stylized"
              ? ` · ${Math.round(styleAssessment.realismStrength * 100)}% realism normalization`
              : ""}
          </span>
        </div>
      )}
      <div className="inline-note">
        <InfoIcon />
        <span>
          Front view controls widths. Good angled views corroborate vertical shape;
          poor or contradictory views are ignored. Provider refinement uses the front image.
        </span>
      </div>
    </section>
  );
}
