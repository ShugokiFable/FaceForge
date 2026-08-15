import { useCallback, useEffect, useRef, useState } from "react";
import { noseProjection, type FaceAnalysis } from "../domain/faceAnalysis";
import {
  measureRenderDataUrl,
  rawLandmarksFromDataUrl,
  renderHeads,
  reshapedRenderRequest,
  type RenderTargetMeta
} from "../domain/headRender";
import {
  buildTargetsFromViews,
  DEBUG,
  fitSliders,
  scoreSliders,
  type FitProgress,
  type ProfileTarget
} from "../domain/fit";
import { postNative } from "../domain/nativeBridge";
import { ScanIcon } from "./Icons";

export interface ReferenceSource {
  id: string;
  label: string;
  url: string;
  analysis?: FaceAnalysis | null;
}

interface MatchPanelProps {
  meta: RenderTargetMeta | null;
  nativeAvailable: boolean;
  indexed: boolean;
  initialSources: ReferenceSource[];
  currentSliders: Record<string, number>;
  /** Export likeness strength (0-1). The preview scales by it so it matches what actually exports. */
  likeness: number;
  /** The EFM sliders the fit may move (the install's full set). Empty falls back to the built-in 35. */
  sliderNames: readonly string[];
  /** Race/sex/head baseline measurements, used for deviation-space fitting. */
  baselines: Record<string, number>;
  onApplyFit: (sliders: Record<string, number>) => void;
  /** Read-only "Analyze fit": ask the vision model to rate the CURRENT sliders (no changes applied). */
  onAnalyzeFit?: () => void;
  /** The model is currently rating the fit. */
  assessing?: boolean;
  /** The model's last read-only critique: a 0-100 rating plus short comments. */
  assessment?: { fitScore?: number | null; observations: string[] } | null;
  error: string | null;
}

/**
 * The angle to render a view at for the side-by-side. Known guided roles use a fixed sign (the
 * detector's signed yaw on a steep side shot is unreliable, and mis-signing it turned the "left"
 * render the wrong way); added angles fall back to the measured yaw.
 */
const displayYaw = (source: ReferenceSource): number => {
  if (source.id === "left") return -30;
  if (source.id === "right") return 30;
  if (source.id === "front") return 0;
  const yaw = source.analysis?.yawOffset ?? 0;
  return Math.max(-55, Math.min(55, Math.round(yaw * 140)));
};

const fitScore = (loss: number): number => Math.max(0, Math.min(100, Math.round(100 * Math.exp(-loss * 2.2))));

/**
 * Manual controls for the sculpt reshape sentinels -- the depth/shape levers the EFM sliders can't
 * express and the auto-fit drives (nose projection especially). They are not install morphs, so they
 * never appear in the normal slider list; exposing them here lets the user correct e.g. an over-driven
 * nose by hand. The profile preview above updates live, and the export bakes them into the sculpt.
 */
const RESHAPE_CONTROLS: { key: string; label: string; hint: string }[] = [
  { key: "__NoseForward", label: "Nose forward", hint: "− pulls the nose back in" },
  { key: "__FaceWidthScale", label: "Face width", hint: "− narrows / elongates" },
  { key: "__FaceHeightScale", label: "Face height", hint: "+ lengthens" },
  { key: "__JawHeight", label: "Jaw line", hint: "+ raises the jaw corners" }
];

export default function MatchPanel({
  meta,
  nativeAvailable,
  indexed,
  initialSources,
  currentSliders,
  likeness,
  sliderNames,
  baselines,
  onApplyFit,
  onAnalyzeFit,
  assessing,
  assessment,
  error
}: MatchPanelProps) {
  const [sources, setSources] = useState<ReferenceSource[]>(initialSources);
  const [renders, setRenders] = useState<Record<string, string>>({});
  const [previewSliders, setPreviewSliders] = useState<Record<string, number>>(currentSliders);
  const [fitting, setFitting] = useState(false);
  const [progress, setProgress] = useState<FitProgress | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [measuredScore, setMeasuredScore] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const renderToken = useRef(0);
  const available = nativeAvailable && indexed && meta !== null;

  // Adopt a new front source list (a re-analysis) but keep any extra angles the user added here.
  useEffect(() => {
    setSources((current) => {
      const extras = current.filter((item) => item.id.startsWith("angle-"));
      return [...initialSources, ...extras];
    });
  }, [initialSources]);

  // Fill in measurements for any source that arrived without them (added angles, guided sides).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const source of sources) {
        if (source.analysis !== undefined) continue;
        const analysis = await measureRenderDataUrl(source.url).catch(() => null);
        if (cancelled) return;
        setSources((current) =>
          current.map((item) => (item.id === source.id ? { ...item, analysis } : item))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const renderPreviews = useCallback(
    async (sliders: Record<string, number>) => {
      if (!available || !meta || sources.length === 0) return;
      const token = ++renderToken.current;
      try {
        // Scale by likeness so the preview shows what actually EXPORTS (export = values × likeness).
        // At likeness < 100% the exported morphs are weaker (e.g. a bigger nose in-game than a
        // full-strength preview showed); reflecting it here keeps preview and in-game in agreement.
        const applied =
          Math.abs(likeness - 1) < 1e-6
            ? sliders
            : Object.fromEntries(Object.entries(sliders).map(([key, value]) => [key, value * likeness]));
        const requests = sources.map((source) =>
          reshapedRenderRequest(source.id, applied, { yaw: displayYaw(source), textured: true })
        );
        // A strong-profile render so the DEPTH reshape (nose-forward, and any chin projection) is
        // visible: those changes are invisible in a front view but very visible in-game. Without this,
        // an over-projected nose reads as fine in the preview and only shows up in Skyrim.
        requests.push(reshapedRenderRequest("__profile", applied, { yaw: 80, textured: true }));
        const images = await renderHeads(meta, requests);
        if (token !== renderToken.current) return;
        const next: Record<string, string> = {};
        for (const [id, url] of images) next[id] = url;
        setRenders(next);
      } catch {
        /* preview is best-effort; the fit does not depend on it. */
      }
    },
    [available, meta, sources, likeness]
  );

  useEffect(() => {
    setPreviewSliders(currentSliders);
    void renderPreviews(currentSliders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderPreviews]);

  // Re-render the preview when the sliders change (e.g. manual edits in the right pane), debounced so
  // dragging a slider does not fire a native render on every pixel.
  useEffect(() => {
    if (!available || fitting) return;
    const timer = window.setTimeout(() => {
      setPreviewSliders(currentSliders);
      void renderPreviews(currentSliders);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSliders]);

  const addAngle = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setSources((current) => [
      ...current,
      { id: `angle-${Date.now()}`, label: file.name, url, analysis: undefined }
    ]);
  }, []);

  const removeSource = useCallback((id: string) => {
    setSources((current) => current.filter((item) => item.id !== id));
    setRenders((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const analyzed = sources.filter((source) => source.analysis);

  // DEBUG TRACE (gated by the fit.ts DEBUG constant): after each pass, render a dedicated front + strong
  // profile at that pass's sliders and hand them + the numeric trace to native, which saves
  // <base>_pass<N>_front/profile.png and appends the "why" (sliders moved, measurements chased) to
  // trace.md under Documents\FaceForge Debug\<base>\. This is how we narrow down which stage deforms the
  // face -- e.g. a late polish pass re-touching the chin the contour stage already set.
  const debugBaseName = useCallback(() => {
    const raw = sources[0]?.label ?? "fit";
    return raw.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "fit";
  }, [sources]);

  const saveDebugPass = useCallback(
    async (update: FitProgress) => {
      if (!DEBUG || !meta) return;
      try {
        const s = update.sliders;
        const applied =
          Math.abs(likeness - 1) < 1e-6
            ? s
            : Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v * likeness]));
        const imgs = await renderHeads(meta, [
          reshapedRenderRequest("dbg_front", applied, { yaw: 0, textured: true }),
          reshapedRenderRequest("dbg_prof", applied, { yaw: 80, textured: true })
        ]);
        const t = update.trace;
        const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");
        const lines: string[] = [];
        lines.push(`\n## Pass ${update.iteration}/${update.totalIterations} — ${update.label ?? ""}`);
        lines.push(
          `loss ${fmt(update.loss)} · penalty ${fmt(t?.penalty ?? 0)} · ${update.improved ? "improved" : "no change"}`
        );
        if (t) {
          lines.push(`allowed to move: ${t.allowedVars.length} sliders`);
          if (t.changed.length === 0) lines.push(`changed: (none)`);
          else {
            lines.push(`changed (${t.changed.length}):`);
            for (const c of t.changed) lines.push(`  - ${c.name}: ${fmt(c.from)} → ${fmt(c.to)}  (Δ ${fmt(c.delta)})`);
          }
          if (t.residuals.length) {
            lines.push(`chasing (worst measurement residuals after this pass):`);
            for (const r of t.residuals)
              lines.push(`  - ${r.key}: target ${fmt(r.target)} vs render ${fmt(r.got)}  (err ${fmt(r.weightedError)})`);
          }
        }
        postNative({
          type: "save-debug",
          baseName: debugBaseName(),
          pass: update.iteration,
          reset: update.iteration === 1,
          front: imgs.get("dbg_front") ?? "",
          profile: imgs.get("dbg_prof") ?? "",
          log: lines.join("\n") + "\n"
        });
      } catch {
        /* debug saving is best-effort; never let it break the fit. */
      }
    },
    [meta, likeness, debugBaseName]
  );

  const improve = useCallback(async () => {
    if (!available || !meta) return;
    const analyses = sources
      .map((source) => source.analysis)
      .filter((item): item is FaceAnalysis => Boolean(item));
    if (analyses.length === 0) {
      setNotice("Add at least one clear photo the detector can read before improving.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setFitting(true);
    setNotice(null);
    setProgress(null);
    try {
      const targets = buildTargetsFromViews(analyses);
      // Lateral nose-projection targets from the side photos -- the depth the front views can't carry.
      // Measured on raw (uncorrected) landmarks; near-frontal views (|projection| tiny) are skipped.
      const profileTargets: ProfileTarget[] = [];
      for (const source of sources) {
        if (!(source.id === "left" || source.id === "right" || source.id.startsWith("angle-"))) continue;
        const raw = await rawLandmarksFromDataUrl(source.url).catch(() => null);
        if (!raw) continue;
        const projection = noseProjection(raw.landmarks, raw.aspect);
        if (projection == null || Math.abs(projection) < 0.02) continue;
        profileTargets.push({ renderYaw: displayYaw(source), noseProjection: projection });
      }
      const result = await fitSliders({
        meta,
        initial: currentSliders,
        targets,
        baseline: baselines,
        sliders: sliderNames,
        profileTargets,
        iterations: 5,
        signal: controller.signal,
        onProgress: (update) => {
          setProgress(update);
          setScore(fitScore(update.loss));
          setPreviewSliders(update.sliders);
          void renderPreviews(update.sliders);
          void saveDebugPass(update);
        }
      });
      onApplyFit(result.sliders);
      setScore(fitScore(result.loss));
      setPreviewSliders(result.sliders);
      void renderPreviews(result.sliders);
      setNotice(
        `Sliders fitted to ${analyses.length} view${analyses.length === 1 ? "" : "s"} over ${result.iterations} pass${result.iterations === 1 ? "" : "es"}. Fit score ${fitScore(result.loss)} / 100.`
      );
    } catch (reason) {
      if ((reason as DOMException)?.name === "AbortError") setNotice("Improvement cancelled.");
      else setNotice(reason instanceof Error ? reason.message : "The fit could not complete.");
    } finally {
      setFitting(false);
      abortRef.current = null;
    }
  }, [available, meta, sources, currentSliders, sliderNames, baselines, onApplyFit, renderPreviews, saveDebugPass]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  // "Analyze fit": rate the CURRENT sliders without changing them. Computes the objective measured
  // loss locally and asks the vision model for an independent 0-100 rating plus comments.
  const analyzeFit = useCallback(async () => {
    onAnalyzeFit?.(); // the model critique runs in the parent; it manages its own busy/error state
    if (!available || !meta) return;
    const analyses = sources
      .map((source) => source.analysis)
      .filter((item): item is FaceAnalysis => Boolean(item));
    if (analyses.length === 0) return;
    setMeasuring(true);
    try {
      const loss = await scoreSliders({
        meta,
        initial: currentSliders,
        targets: buildTargetsFromViews(analyses),
        baseline: baselines
      });
      setMeasuredScore(fitScore(loss));
    } catch {
      /* the measured score is best-effort; the model rating still shows. */
    } finally {
      setMeasuring(false);
    }
  }, [available, meta, sources, currentSliders, baselines, onAnalyzeFit]);

  return (
    <section className="workspace-panel match-panel">
      <div className="panel-heading">
        <span className="step-number">2</span>
        <h2>Match &amp; improve</h2>
      </div>

      {!available && (
        <div className="settings-empty">
          {!nativeAvailable
            ? "Live preset rendering and fitting are available in the Windows app."
            : !indexed
              ? "Index your Skyrim install (Settings) so FaceForge can render your actual head."
              : "Pick a target sex to enable the preset renderer."}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="match-toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={!available || fitting || analyzed.length === 0}
          onClick={improve}
        >
          <ScanIcon />
          {fitting ? "Improving…" : "Analyze & improve"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!available || fitting || measuring || assessing || analyzed.length === 0}
          onClick={analyzeFit}
          title="Rate the current sliders without changing them — measured proportions plus a vision-model opinion"
        >
          {measuring || assessing ? "Analyzing…" : "Analyze fit"}
        </button>
        {fitting ? (
          <button type="button" className="text-button" onClick={cancel}>Cancel</button>
        ) : (
          <label className="text-button match-add">
            + Add angle
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addAngle(file);
                event.target.value = "";
              }}
            />
          </label>
        )}
        {score !== null && <span className="match-score">Fit score {score}/100</span>}
      </div>

      {(measuredScore !== null || measuring || assessing || assessment) && (
        <div className="match-assessment">
          {measuredScore !== null && (
            <div className="match-assessment-line">
              Measured fit <strong>{measuredScore}/100</strong> <span className="match-assessment-note">(landmark proportions — good for comparing tweaks, not an absolute likeness)</span>
            </div>
          )}
          {assessing && <div className="match-assessment-line">Vision model is reviewing the fit…</div>}
          {assessment?.fitScore != null && (
            <div className="match-assessment-line">
              Vision model rates <strong>{assessment.fitScore}/100</strong>
            </div>
          )}
          {assessment && assessment.observations.length > 0 && (
            <ul className="match-assessment-comments">
              {assessment.observations.map((comment, index) => (
                <li key={index}>{comment}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {progress && (
        <div className="match-progress">
          <div className="match-progress-bar">
            <span style={{ width: `${Math.round((progress.iteration / progress.totalIterations) * 100)}%` }} />
          </div>
          <small>
            {progress.label ? `${progress.label} · ` : ""}stage {progress.iteration} of {progress.totalIterations} · {progress.improved ? "improving" : "converged"}
          </small>
        </div>
      )}

      {notice && <div className="match-notice">{notice}</div>}

      {renders.__profile && (
        <div className="match-profile-check">
          <figure>
            <img src={renders.__profile} alt="Preset profile" className="zoomable" onClick={() => setZoomUrl(renders.__profile)} />
            <figcaption>profile · depth check (nose &amp; chin projection — what you can't see head-on)</figcaption>
          </figure>
        </div>
      )}

      {available && (
        <details className="reshape-controls">
          <summary>Manual reshape — sculpt (shown in the profile above, baked into the export)</summary>
          {RESHAPE_CONTROLS.map((control) => (
            <label key={control.key} className="reshape-row">
              <span className="reshape-label">{control.label} <em>{control.hint}</em></span>
              <input
                type="range"
                min={-3}
                max={3}
                step={0.1}
                value={currentSliders[control.key] ?? 0}
                onChange={(event) => onApplyFit({ [control.key]: Number(event.target.value) })}
              />
              <span className="reshape-val">{(currentSliders[control.key] ?? 0).toFixed(1)}</span>
            </label>
          ))}
        </details>
      )}

      <div className="match-views">
        {sources.length === 0 && (
          <div className="settings-empty">Analyze a photo first, then add more angles here to match against all of them.</div>
        )}
        {sources.map((source) => (
          <div className="match-view" key={source.id}>
            <div className="match-pair">
              <figure>
                <img src={source.url} alt={`Reference ${source.label}`} className="zoomable" onClick={() => setZoomUrl(source.url)} />
                <figcaption>
                  photo{source.analysis ? ` · yaw ${displayYaw(source)}°` : source.analysis === null ? " · no face found" : " · reading…"}
                </figcaption>
              </figure>
              <figure>
                {renders[source.id] ? (
                  <img src={renders[source.id]} alt="Preset render" className="zoomable" onClick={() => setZoomUrl(renders[source.id])} />
                ) : (
                  <div className="match-render-placeholder">{available ? "rendering…" : "preview off"}</div>
                )}
                <figcaption>your preset</figcaption>
              </figure>
            </div>
            {source.id.startsWith("angle-") && !fitting && (
              <button type="button" className="text-button match-remove" onClick={() => removeSource(source.id)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {zoomUrl && (
        <div className="lightbox" role="dialog" aria-label="Zoomed image" onClick={() => setZoomUrl(null)}>
          <img src={zoomUrl} alt="Zoomed" />
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setZoomUrl(null)}>×</button>
        </div>
      )}
    </section>
  );
}
