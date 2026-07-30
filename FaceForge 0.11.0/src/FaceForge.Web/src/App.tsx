import { useCallback, useEffect, useMemo, useState } from "react";
import AboutModal, { type VisionSettings } from "./components/AboutModal";
import AnalysisPanel from "./components/AnalysisPanel";
import Header from "./components/Header";
import { DownloadIcon, MonitorIcon } from "./components/Icons";
import OutputPanel, { type OutputMode } from "./components/OutputPanel";
import SourcePanel from "./components/SourcePanel";
import {
  EFM_RANGE,
  NO_CORRECTION_NEEDED,
  createNeutralEfmSliders,
  generateEfmSliders,
  measureFace,
  normalizeStylizedAnalysis,
  recommendFeatureTargets,
  recommendRaceFoundations,
  sliderRecord,
  type FaceAnalysis,
  type FaceLandmark,
  type SliderGroup
} from "./domain/faceAnalysis";
import {
  assessImageStyle,
  type SourceMode,
  type StyleAssessment
} from "./domain/imageStyle";
import {
  analyzePortrait,
  analyzePortraitUpright,
  blendshapeMap
} from "./domain/mediapipe";
import {
  assessView,
  fuseFaceAnalyses,
  measureImageQuality,
  selectVideoViews,
  signedYawOffset,
  type AnalyzedView,
  type ViewReport,
  type ViewRole
} from "./domain/multiView";
import {
  hasNativeBridge,
  postNative,
  resizeImageForVision,
  subscribeNative,
  type CliProviderStatus,
  type AppearanceChoice,
  type AppearanceSex,
  type EnvironmentSummary,
  type ExportResult,
  type PlayableRace,
  type PresetReport,
  type PluginProvider,
  type TemplatePayload,
  type VisionResult
} from "./domain/nativeBridge";
import {
  readSliderInventory,
  type SliderInventory
} from "./domain/sliderCatalog";
import {
  buildRaceMenuPreset,
  createFreshRaceMenuTemplate,
  parseRaceMenuTemplate,
  serializeRaceMenuPreset,
  triggerPresetDownload,
  type RaceMenuTemplate
} from "./domain/racemenu";

type AppStatus = "waiting" | "ready" | "working" | "error";
type CaptureMode = "single" | "guided";

interface SourceAsset {
  file: File;
  url: string;
  image: HTMLImageElement;
}

const clampSlider = (value: number) =>
  Math.max(-EFM_RANGE, Math.min(EFM_RANGE, Math.round(value * 1000) / 1000));

/**
 * Race recommendations are ranked by geometry and named in plain English; the installed RACE
 * records are the authority for what can actually be picked. Match on the record's display name
 * first, then on an EditorID prefix, and never invent a race the game does not have.
 */
const matchInstalledRace = (
  raceName: string,
  playableRaces: readonly PlayableRace[]
): PlayableRace | null => {
  const target = raceName.replace(/\s+/g, "").toLowerCase();
  return (
    playableRaces.find(
      (race) => (race.name ?? "").replace(/\s+/g, "").toLowerCase() === target
    ) ??
    playableRaces.find((race) => race.editorId.toLowerCase().startsWith(target)) ??
    null
  );
};

const initialFreshFoundation = createFreshRaceMenuTemplate();

const loadImageAsset = (file: File): Promise<SourceAsset> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ file, url, image });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not decode ${file.name}.`));
    };
    image.src = url;
  });

const canvasFile = (
  canvas: HTMLCanvasElement,
  name: string
): Promise<File> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], name, { type: "image/jpeg" }))
          : reject(new Error("Could not capture a frame from the video.")),
      "image/jpeg",
      0.92
    )
  );

const seekVideo = (video: HTMLVideoElement, time: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
      reject(new Error("The selected video could not be read."));
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = time;
  });

export default function App() {
  const nativeAvailable = hasNativeBridge();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("auto");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("single");
  const [sideViews, setSideViews] = useState<
    Partial<Record<Exclude<ViewRole, "front">, SourceAsset>>
  >({});
  const [viewReports, setViewReports] = useState<ViewReport[]>([]);
  const [multiViewConfidence, setMultiViewConfidence] = useState<number | null>(null);
  const [videoProgress, setVideoProgress] = useState<string | null>(null);
  const [styleAssessment, setStyleAssessment] = useState<StyleAssessment | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [landmarks, setLandmarks] = useState<readonly FaceLandmark[] | null>(null);
  const [analysis, setAnalysis] = useState<FaceAnalysis | null>(null);
  const [groups, setGroups] = useState<SliderGroup[]>([]);
  const [generatedValues, setGeneratedValues] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [template, setTemplate] = useState<RaceMenuTemplate | null>(
    initialFreshFoundation
  );
  const [presetName, setPresetName] = useState("FaceForge_Preset");
  const [likeness, setLikeness] = useState(1);
  const [preserveSculpt, setPreserveSculpt] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("preset-pack");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [targetSex, setTargetSex] = useState<Exclude<AppearanceSex, "any" | "unflagged">>(
    "female"
  );
  const [targetRace, setTargetRace] = useState<string | null>(null);
  const [sliderInventory, setSliderInventory] = useState<SliderInventory | null>(null);
  const [presetReport, setPresetReport] = useState<PresetReport | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentSummary | null>(null);
  const [appearanceSelections, setAppearanceSelections] = useState<
    Partial<Record<AppearanceChoice["category"], AppearanceChoice>>
  >({});
  const [dependencyIndexed, setDependencyIndexed] = useState(false);
  const [dependencies, setDependencies] = useState<PluginProvider[]>(
    initialFreshFoundation.summary.dependencies.map((pluginName) => ({
      pluginName,
      sourceMod: null,
      present: false,
      baseGame: pluginName.toLowerCase() === "skyrim.esm",
      sourceBsaCount: 0,
      sourceRelevantAssetCount: 0
    }))
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [visionResult, setVisionResult] = useState<VisionResult | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<CliProviderStatus[]>([]);
  const [vision, setVision] = useState<VisionSettings>({
    enabled: false,
    provider: "codex",
    apiKey: "",
    model: "",
    consent: false
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(
    "Choose a photo to begin. A source JSlot is optional."
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedAppearance = useMemo(
    () => Object.values(appearanceSelections).filter(
      (item): item is AppearanceChoice => Boolean(item)
    ),
    [appearanceSelections]
  );
  const requiredPlugins = useMemo(() => {
    const values = new Set(template?.summary.dependencies ?? []);
    for (const choice of selectedAppearance) {
      values.add(choice.pluginName);
      for (const master of choice.masters) values.add(master);
      const separator = choice.formIdentifier.indexOf("|");
      if (separator > 0) values.add(choice.formIdentifier.slice(0, separator));
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [selectedAppearance, template]);

  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl]
  );

  const loadTemplatePayload = useCallback((payload: TemplatePayload) => {
    try {
      const parsed = parseRaceMenuTemplate(payload.contents, payload.fileName, {
        sourceId: payload.sourceId,
        layout: payload.layout,
        hasNif: Boolean(payload.nifPath),
        hasDds: Boolean(payload.ddsPath)
      });
      setTemplate(parsed);
      setPresetName(`${payload.fileName.replace(/\.jslot$/i, "")}_FaceForge`);
      setPreserveSculpt(false);
      setOutputMode("preset-pack");
      setPermissionConfirmed(false);
      setAppearanceSelections({});
      setDependencyIndexed(false);
      setDependencies(
        parsed.summary.dependencies.map((pluginName) => ({
          pluginName,
          sourceMod: null,
          present: false,
          baseGame: false,
          sourceBsaCount: 0,
          sourceRelevantAssetCount: 0
        }))
      );
      setError(null);
      setNotice(
        parsed.summary.hasSculpt
          ? `Template loaded with ${parsed.summary.sculptHostCount} sculpt host(s). Preserve Sculpt keeps its matching geometry.`
          : "Template loaded. Race, head parts, tint, and declared dependencies will be preserved."
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Template could not be read.";
      setTemplate(null);
      setDependencies([]);
      setError(message);
      setNotice(message);
    }
  }, []);

  useEffect(() => subscribeNative((message) => {
    const payload = message.payload as Record<string, unknown>;
    switch (message.type) {
      case "index-started":
        setIsIndexing(true);
        setError(null);
        setNotice(
          payload.automatic
            ? `Skyrim detected through ${String(payload.detectionMethod ?? "Windows")}. Indexing Vortex, CharGen, and appearance assets…`
            : "Reading the Vortex deployment manifest and indexing relevant Skyrim assets…"
        );
        break;
      case "environment-detection-started":
        setNotice("Looking for Skyrim, Steam libraries, Vortex deployment, and CharGen automatically…");
        break;
      case "environment-not-detected":
        setNotice("Skyrim was not detected automatically. Choose its game or Data folder in Settings.");
        break;
      case "environment-detection-failed":
        setIsIndexing(false);
        setNotice(
          `Automatic Skyrim indexing could not finish: ${String(payload.message ?? "unknown error")}. Manual selection remains available.`
        );
        break;
      case "index-cancelled":
        setIsIndexing(false);
        setNotice("Environment indexing was cancelled.");
        break;
      case "environment-indexed": {
        const indexed = message.payload as EnvironmentSummary;
        setEnvironment(indexed);
        setAppearanceSelections({});
        setIsIndexing(false);
        setError(null);
        setNotice(
          `${indexed.autoDetected ? "Automatically indexed" : "Indexed"} ${indexed.sourceModCount.toLocaleString()} source mods, ${indexed.pluginCount.toLocaleString()} plugins, ${indexed.presetCount.toLocaleString()} CharGen presets, ${indexed.appearanceChoices.length.toLocaleString()} exact head-part records, and ${indexed.playableRaces.length} playable races.`
        );
        break;
      }
      case "baked-head-missing":
        setError(null);
        setNotice(
          `No baked head named "${String(payload.name ?? "")}" yet. In RaceMenu, load the preset, then save it back out with sculpt data so Skyrim writes ${String(payload.expectedNif ?? "the CharGen NIF")} beside it.`
        );
        break;
      case "template-loaded":
        loadTemplatePayload(message.payload as TemplatePayload);
        break;
      case "preset-inspected": {
        const report = message.payload as PresetReport;
        setPresetReport(report);
        setError(null);
        setNotice(
          report.shareReady
            ? `${report.fileName}: ${report.customMorphCount} sliders, ${report.headParts.length} head parts, ${report.dependencies.length} required plugins, all present. Ready to share.`
            : `${report.fileName} needs ${report.blockers.length} thing${report.blockers.length === 1 ? "" : "s"} fixed before it can be shared.`
        );
        break;
      }
      case "baked-head-found": {
        // Skyrim finished the round trip: the CharGen NIF/DDS now exist, so the JSlot and the
        // baked head can be packaged together as something Follower Forge can actually consume.
        const baked = message.payload as TemplatePayload;
        loadTemplatePayload(baked);
        setPreserveSculpt(true);
        setOutputMode("follower-head-kit");
        setNotice(
          `Found the baked head for ${baked.fileName}. Confirm the redistribution checkbox and export the Follower Head Kit.`
        );
        break;
      }
      case "dependencies-resolved": {
        const result = message.payload as {
          indexed: boolean;
          dependencies: PluginProvider[];
        };
        setDependencyIndexed(result.indexed);
        setDependencies(result.dependencies);
        break;
      }
      case "vision-started":
        setIsRefining(true);
        setError(null);
        setNotice(`The prepared portrait is being reviewed by ${String(payload.model ?? "the selected model")}…`);
        break;
      case "vision-provider-status":
        setProviderStatuses(message.payload as CliProviderStatus[]);
        break;
      case "vision-connect-started":
        setError(null);
        setNotice(String(payload.message ?? "The provider sign-in was opened."));
        postNative({ type: "vision-provider-status" });
        break;
      case "vision-complete": {
        const result = message.payload as VisionResult;
        setVisionResult(result);
        setGeneratedValues((current) => {
          const neutralGroups = createNeutralEfmSliders();
          const baseline =
            Object.keys(current).length > 0
              ? current
              : sliderRecord(neutralGroups);
          if (Object.keys(current).length === 0) setGroups(neutralGroups);
          const next = { ...baseline };
          for (const [key, delta] of Object.entries(result.sliderDeltas)) {
            if (key in baseline) next[key] = clampSlider(baseline[key] + delta);
          }
          setValues(next);
          return next;
        });
        setIsRefining(false);
        setError(null);
        setNotice(
          `Vision produced ${Object.keys(result.sliderDeltas).length} bounded Skyrim controls at ${Math.round(result.confidence * 100)}% model confidence.`
        );
        break;
      }
      case "export-complete": {
        const result = message.payload as ExportResult;
        setError(null);
        setNotice(
          `${result.mode === "follower-head-kit"
            ? "Follower Head Kit"
            : result.mode === "racemenu-export-stage"
              ? "RaceMenu Head Export"
              : "Preset Pack"} exported with ${result.fileCount} files. SHA-256 ${result.sha256.slice(0, 12)}…`
        );
        break;
      }
      case "native-error": {
        const messageText = String(payload.message ?? "The desktop operation failed.");
        setIsAnalyzing(false);
        setIsIndexing(false);
        setIsRefining(false);
        setError(messageText);
        setNotice(messageText);
        break;
      }
    }
  }), [loadTemplatePayload]);

  useEffect(() => {
    if (nativeAvailable) postNative({ type: "vision-provider-status" });
  }, [nativeAvailable]);

  useEffect(() => {
    if (!template || !nativeAvailable) return;
    postNative({
      type: "resolve-dependencies",
      dependencies: requiredPlugins
    });
  }, [environment, nativeAvailable, requiredPlugins, template]);

  const status: AppStatus = useMemo(() => {
    if (isAnalyzing || isIndexing || isRefining) return "working";
    if (error) return "error";
    if (groups.length > 0 && template) return "ready";
    return "waiting";
  }, [error, groups.length, isAnalyzing, isIndexing, isRefining, template]);

  const choosePhoto = useCallback((file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP portrait.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setPhotoFile(file);
    setPhotoUrl(nextUrl);
    setPhotoName(file.name);
    setLandmarks(null);
    setAnalysis(null);
    setStyleAssessment(null);
    setGroups([]);
    setGeneratedValues({});
    setValues({});
    setViewReports([]);
    setMultiViewConfidence(null);
    setVisionResult(null);
    setError(null);
    setNotice("Photo loaded. Run the local face analysis.");
  }, []);

  const chooseSidePhoto = useCallback(
    async (role: Exclude<ViewRole, "front">, file: File) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError("Choose a JPEG, PNG, or WebP portrait.");
        return;
      }
      try {
        const asset = await loadImageAsset(file);
        setSideViews((current) => {
          if (current[role]) URL.revokeObjectURL(current[role]!.url);
          return { ...current, [role]: asset };
        });
        setViewReports([]);
        setMultiViewConfidence(null);
        setGroups([]);
        setGeneratedValues({});
        setValues({});
        setError(null);
        setNotice(`${role === "left" ? "Left" : "Right"} angle loaded. Analyze the face set.`);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The image could not be read.");
      }
    },
    []
  );

  const chooseView = useCallback(
    (role: ViewRole, file: File) => {
      if (role === "front") choosePhoto(file);
      else void chooseSidePhoto(role, file);
    },
    [choosePhoto, chooseSidePhoto]
  );

  const chooseTurnVideo = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("video/")) {
        setError("Choose a video file supported by Windows and WebView2.");
        return;
      }
      setCaptureMode("guided");
      setIsAnalyzing(true);
      setError(null);
      setVideoProgress("Opening turn video…");
      const videoUrl = URL.createObjectURL(file);
      try {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.src = videoUrl;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("This video format could not be decoded."));
        });
        if (!Number.isFinite(video.duration) || video.duration <= 0)
          throw new Error("The video has no readable duration.");
        const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Video frame capture is unavailable.");
        const candidates: Array<{
          value: File;
          yaw: number;
          quality: number;
        }> = [];
        const sampleCount = 15;
        for (let index = 0; index < sampleCount; index += 1) {
          setVideoProgress(`Scanning turn video ${index + 1}/${sampleCount}…`);
          const time = video.duration * (0.06 + (index / (sampleCount - 1)) * 0.88);
          await seekVideo(video, time);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = await analyzePortrait(canvas);
          if (result.faceLandmarks.length !== 1) continue;
          const detected = result.faceLandmarks[0] as readonly FaceLandmark[];
          const quality = measureImageQuality(
            canvas,
            canvas.width,
            canvas.height,
            detected
          );
          candidates.push({
            value: await canvasFile(
              canvas,
              `${file.name.replace(/\.[^.]+$/, "")}-frame-${index + 1}.jpg`
            ),
            yaw: signedYawOffset(detected, canvas.width / canvas.height),
            quality: quality.score
          });
        }
        const selected = selectVideoViews(candidates);
        if (!selected.front)
          throw new Error("No clear single face was found in the turn video.");
        choosePhoto(selected.front.value);
        const selectedSides = await Promise.all(
          (["left", "right"] as const).map(async (role) => [
            role,
            selected[role] ? await loadImageAsset(selected[role]!.value) : undefined
          ] as const)
        );
        setSideViews((current) => {
          if (current.left) URL.revokeObjectURL(current.left.url);
          if (current.right) URL.revokeObjectURL(current.right.url);
          return Object.fromEntries(
            selectedSides.filter((entry) => Boolean(entry[1]))
          ) as Partial<Record<Exclude<ViewRole, "front">, SourceAsset>>;
        });
        const angleCount = selectedSides.filter((entry) => entry[1]).length;
        setNotice(
          `Turn video selected a front frame and ${angleCount} useful angle${
            angleCount === 1 ? "" : "s"
          }. Run Analyze face set.`
        );
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Turn video scanning failed.";
        setError(message);
        setNotice(message);
      } finally {
        URL.revokeObjectURL(videoUrl);
        setVideoProgress(null);
        setIsAnalyzing(false);
      }
    },
    [choosePhoto]
  );

  const runAnalysis = useCallback(async () => {
    if (!imageElement) return;
    setIsAnalyzing(true);
    setError(null);
    setVisionResult(null);
    setNotice("Loading the local model and measuring visible facial proportions…");
    try {
      const assessedStyle = assessImageStyle(imageElement, sourceMode);
      setStyleAssessment(assessedStyle);
      const sources: Array<{ role: ViewRole; image: HTMLImageElement }> = [
        { role: "front", image: imageElement },
        ...(captureMode === "guided" && sideViews.left
          ? [{ role: "left" as const, image: sideViews.left.image }]
          : []),
        ...(captureMode === "guided" && sideViews.right
          ? [{ role: "right" as const, image: sideViews.right.image }]
          : [])
      ];
      const analyzed: AnalyzedView[] = [];
      const rejectedReports: ViewReport[] = [];
      let frontLandmarks: readonly FaceLandmark[] | null = null;
      for (const source of sources) {
        const upright = await analyzePortraitUpright(source.image);
        const result = upright.result;
        if (result.faceLandmarks.length !== 1) {
          if (source.role === "front") {
            if (result.faceLandmarks.length > 1)
              throw new Error("More than one face was detected. Crop the front image to one person.");
            if (assessedStyle.kind === "stylized")
              throw new Error(
                "The illustration was recognized as stylized, but the local landmark model could not map it. Enable vision refinement to build the 35-slider Skyrim interpretation from neutral."
              );
            throw new Error("No face was detected. Use a clearer, front-facing portrait.");
          }
          rejectedReports.push({
            role: source.role,
            detectedRole: source.role,
            yaw: 0,
            quality: {
              score: 0,
              brightness: 0,
              contrast: 0,
              sharpness: 0,
              faceCoverage: 0,
              warnings: []
            },
            score: 0,
            used: false,
            warnings: [
              result.faceLandmarks.length > 1
                ? "More than one face was detected."
                : "No face was detected."
            ]
          });
          continue;
        }
        const detected = result.faceLandmarks[0] as readonly FaceLandmark[];
        // Measure in the straightened frame, whose aspect ratio is the rotated canvas, not the
        // original photo. Overlay coordinates come from the first pass further down.
        const sourceAspectRatio = upright.width / upright.height;
        const rawMeasured = measureFace(
          detected,
          blendshapeMap(result),
          sourceAspectRatio
        );
        const interpreted =
          assessedStyle.kind === "stylized"
            ? normalizeStylizedAnalysis(
                rawMeasured,
                assessedStyle.realismStrength
              )
            : rawMeasured;
        // Fold in the tilt that was taken out of the image itself, so the reported correction is
        // the total applied rather than only the residual the landmark stage still saw.
        const refinementNotes = [
          upright.straightenedDegrees !== 0
            ? `Image was straightened by ${Math.abs(upright.straightenedDegrees).toFixed(1)}° before landmark detection; the model reads a tilted face differently.`
            : null,
          upright.zoomFactor > 1
            ? `Face filled only part of the frame, so it was cropped and re-detected at ${upright.zoomFactor.toFixed(1)}× to recover landmark precision.`
            : null
        ].filter((note): note is string => note !== null);
        const measured: FaceAnalysis =
          refinementNotes.length === 0
            ? interpreted
            : {
                ...interpreted,
                // measureFace built its warning list from the notes it knew about, so anything
                // added here has to go into both or the panel silently omits it.
                warnings: [
                  ...refinementNotes,
                  ...interpreted.warnings.filter((entry) => entry !== NO_CORRECTION_NEEDED)
                ],
                correction: {
                  ...interpreted.correction,
                  straightenedDegrees: upright.straightenedDegrees,
                  notes: [...refinementNotes, ...interpreted.correction.notes]
                }
              };
        const quality = measureImageQuality(
          source.image,
          source.image.naturalWidth,
          source.image.naturalHeight,
          detected
        );
        const report = assessView(source.role, measured, detected, quality);
        if (source.role !== "front") {
          // An angled view is turned on purpose, so its pose-correction notes are noise. Only
          // expression contamination is worth surfacing for a side view.
          report.warnings.push(
            ...rawMeasured.warnings.filter((warning) => warning.startsWith("Detected "))
          );
        }
        analyzed.push({ role: source.role, analysis: measured, report });
        // The overlay is drawn on the photo the user chose, so it needs the untouched first-pass
        // landmarks even when the measurements came from a straightened second pass.
        if (source.role === "front") {
          frontLandmarks = upright.original.faceLandmarks[0] as readonly FaceLandmark[];
        }
      }
      const front = analyzed.find((view) => view.role === "front");
      if (!front || !frontLandmarks)
        throw new Error("The front view could not be analyzed.");
      const fused =
        captureMode === "guided"
          ? fuseFaceAnalyses(analyzed)
          : {
              analysis: front.analysis,
              confidence: front.report.quality.score,
              reports: [front.report]
            };
      const reports = [...fused.reports, ...rejectedReports];
      const measured =
        rejectedReports.length > 0
          ? {
              ...fused.analysis,
              warnings: [
                ...fused.analysis.warnings,
                ...rejectedReports.flatMap((report) =>
                  report.warnings.map(
                    (warning) => `${report.role}: ${warning} View ignored.`
                  )
                )
              ]
            }
          : fused.analysis;
      const generatedGroups = generateEfmSliders(measured, sliderInventory);
      const generated = sliderRecord(generatedGroups);
      setLandmarks(frontLandmarks);
      setAnalysis(measured);
      setViewReports(reports);
      setMultiViewConfidence(
        captureMode === "guided" ? fused.confidence : null
      );
      setGroups(generatedGroups);
      setGeneratedValues(generated);
      setValues(generated);
      const heldSliders = generatedGroups
        .flatMap((group) => group.sliders)
        .filter((entry) => entry.confidence < 0.35).length;
      setNotice(
        heldSliders > 0
          ? `Analysis complete. ${heldSliders} slider${heldSliders === 1 ? " was" : "s were"} left at neutral because the source could not measure them; everything else was pose-corrected.`
          : measured.correction.notes.length > 0
            ? "Analysis complete. Tilt, turn, and left/right differences were corrected before measuring."
            : assessedStyle.kind === "stylized"
              ? "Stylized face interpreted and normalized toward believable Skyrim anatomy. Review the editable values."
              : "Local photo analysis complete. Review the editable values or use optional vision refinement."
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Face analysis failed.";
      setError(message);
      setNotice(message);
      setLandmarks(null);
      setAnalysis(null);
      setViewReports([]);
      setMultiViewConfidence(null);
      setGroups([]);
      setGeneratedValues({});
      setValues({});
    } finally {
      setIsAnalyzing(false);
    }
  }, [captureMode, imageElement, sideViews, sliderInventory, sourceMode]);

  const changeSourceMode = useCallback((mode: SourceMode) => {
    setSourceMode(mode);
    setStyleAssessment(null);
    setLandmarks(null);
    setAnalysis(null);
    setGroups([]);
    setGeneratedValues({});
    setValues({});
    setViewReports([]);
    setMultiViewConfidence(null);
    setVisionResult(null);
    setError(null);
    setNotice("Source interpretation changed. Run analysis again.");
  }, []);

  const chooseTemplate = useCallback(async (file: File) => {
    loadTemplatePayload({
      fileName: file.name,
      contents: await file.text(),
      sourceId: null,
      nifPath: null,
      ddsPath: null,
      layout: "browser-file"
    });
  }, [loadTemplatePayload]);

  /**
   * Learns which sliders this RaceMenu install offers by reading a preset saved from it.
   * FaceForge cannot enumerate slider mods from disk -- the names only exist inside RaceMenu at
   * runtime -- but any preset that touched them lists every one.
   */
  const chooseSliderInventory = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const inventory = readSliderInventory(parsed, file.name);
      setSliderInventory(inventory);
      setError(null);
      const families = Object.entries(inventory.familyCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([family, count]) => `${family} ${count}`)
        .join(", ");
      setNotice(
        `Learned ${inventory.names.size} sliders from ${inventory.fileName} (${families}). Run analysis again to use them.`
      );
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "That preset could not be read.";
      setError(message);
      setNotice(message);
    }
  }, []);

  const useFreshFoundation = useCallback(() => {
    const fresh = createFreshRaceMenuTemplate();
    setTemplate(fresh);
    setPreserveSculpt(false);
    setOutputMode("preset-pack");
    setPermissionConfirmed(false);
    setAppearanceSelections({});
    setDependencyIndexed(false);
    setDependencies(
      fresh.summary.dependencies.map((pluginName) => ({
        pluginName,
        sourceMod: null,
        present: false,
        baseGame: pluginName.toLowerCase() === "skyrim.esm",
        sourceBsaCount: 0,
        sourceRelevantAssetCount: 0
      }))
    );
    postNative({ type: "use-fresh-foundation" });
    setError(null);
    setNotice(
      "Fresh photo-built mode selected. Choose the intended race and sex in RaceMenu before loading the generated preset."
    );
  }, []);

  const runVisionRefinement = useCallback(async () => {
    if (!nativeAvailable) {
      setError("Vision refinement is available in the packaged Windows app.");
      return;
    }
    if (!photoFile || !imageElement) {
      setError("Choose a source image before optional vision refinement.");
      return;
    }
    if (!vision.enabled || !vision.consent) {
      setSettingsOpen(true);
      setError("Enable vision and confirm one-request photo-upload consent.");
      return;
    }
    if (vision.provider === "openrouter" &&
        (!vision.apiKey.trim() || !vision.model.trim())) {
      setSettingsOpen(true);
      setError("Enter the OpenRouter API key and image-capable model ID.");
      return;
    }
    const cliStatus = providerStatuses.find((item) => item.id === vision.provider);
    if (vision.provider !== "openrouter" && !cliStatus?.installed) {
      setSettingsOpen(true);
      setError("Install and connect the selected provider’s official CLI first.");
      return;
    }
    const assessedStyle = styleAssessment ?? assessImageStyle(imageElement, sourceMode);
    setStyleAssessment(assessedStyle);
    if (!analysis && assessedStyle.kind !== "stylized") {
      setError(
        "Run local face analysis first. Vision-only fallback is reserved for stylized images the landmark model cannot map."
      );
      return;
    }
    try {
      setIsRefining(true);
      setError(null);
      setNotice("Preparing a reduced portrait for the one-time vision request…");
      const imageDataUrl = await resizeImageForVision(photoFile);
      postNative({
        type: "vision-analyze",
        provider: vision.provider,
        apiKey: vision.apiKey,
        model: vision.model.trim(),
        consent: vision.consent,
        sourceKind: assessedStyle.kind,
        hasLocalAnalysis: Boolean(analysis),
        imageDataUrl
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Vision preparation failed.";
      setIsRefining(false);
      setError(message);
      setNotice(message);
    }
  }, [
    analysis,
    imageElement,
    nativeAvailable,
    photoFile,
    providerStatuses,
    sourceMode,
    styleAssessment,
    vision
  ]);

  const changeSlider = useCallback(
    (name: string, displayedValue: number) => {
      if (!Number.isFinite(displayedValue)) return;
      const raw = likeness > 0.001 ? displayedValue / likeness : displayedValue;
      setValues((current) => ({ ...current, [name]: clampSlider(raw) }));
    },
    [likeness]
  );

  const resetGroup = useCallback(
    (group: SliderGroup) => {
      setValues((current) => {
        const next = { ...current };
        for (const slider of group.sliders) next[slider.name] = generatedValues[slider.name];
        return next;
      });
    },
    [generatedValues]
  );

  const canExport =
    Boolean(template && groups.length > 0) &&
    (outputMode === "preset-pack" ||
      outputMode === "racemenu-export-stage" ||
      (Boolean(template?.companions?.hasNif && template.companions.hasDds) &&
        permissionConfirmed));

  const exportPackage = useCallback(() => {
    if (!template || groups.length === 0) {
      setError("Analyze a portrait before exporting.");
      return;
    }
    if (outputMode === "follower-head-kit" &&
        (!template.companions?.hasNif || !template.companions.hasDds)) {
      setError("Follower Head Kit requires a matched JSLOT, NIF, and DDS trio.");
      return;
    }
    if (outputMode === "follower-head-kit" && !permissionConfirmed) {
      setError("Confirm that you may package the source head assets.");
      return;
    }
    try {
      const scaled = Object.fromEntries(
        Object.entries(values).map(([name, raw]) => [name, clampSlider(raw * likeness)])
      );
      const output = buildRaceMenuPreset(
        template,
        scaled,
        preserveSculpt,
        selectedAppearance
      );
      const contents = serializeRaceMenuPreset(output);
      if (nativeAvailable) {
        postNative({
          type: "export-package",
          mode: outputMode,
          presetName,
          jslotContents: contents,
          preserveSculpt,
          redistributionPermissionConfirmed: permissionConfirmed,
          dependencies: requiredPlugins,
          appearanceChoices: selectedAppearance,
          targetRaceEditorId: targetRace,
          targetSex
        });
      } else {
        triggerPresetDownload(contents, presetName);
        setNotice("Browser preview exported a JSLOT. The Windows app exports the full indexed ZIP package.");
      }
      setError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Package export failed.";
      setError(message);
      setNotice(message);
    }
  }, [
    groups.length,
    likeness,
    nativeAvailable,
    outputMode,
    permissionConfirmed,
    preserveSculpt,
    presetName,
    requiredPlugins,
    selectedAppearance,
    targetRace,
    targetSex,
    template,
    values
  ]);

  const raceRecommendations = useMemo(
    () => (analysis ? recommendRaceFoundations(analysis) : []),
    [analysis]
  );
  const featureTargets = useMemo(
    () => (analysis ? recommendFeatureTargets(analysis) : []),
    [analysis]
  );
  const playableRaces = environment?.playableRaces ?? [];

  // Pre-select the best-ranked race once, but only if it exists as an installed RACE record.
  // The user stays free to change it; head-part filtering follows whatever is chosen here.
  useEffect(() => {
    if (targetRace || raceRecommendations.length === 0 || playableRaces.length === 0) return;
    const matched = matchInstalledRace(raceRecommendations[0].race, playableRaces);
    if (matched) setTargetRace(matched.editorId);
  }, [playableRaces, raceRecommendations, targetRace]);

  return (
    <div className="app-shell">
      <Header
        templateName={template?.fileName ?? null}
        status={status}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace">
        <SourcePanel
          photoName={photoName}
          photoUrl={photoUrl}
          sideViews={Object.fromEntries(
            Object.entries(sideViews).map(([role, asset]) => [
              role,
              { name: asset.file.name, url: asset.url }
            ])
          )}
          captureMode={captureMode}
          landmarks={landmarks}
          sourceMode={sourceMode}
          styleAssessment={styleAssessment}
          viewReports={viewReports}
          multiViewConfidence={multiViewConfidence}
          videoProgress={videoProgress}
          canAnalyze={Boolean(imageElement)}
          isAnalyzing={isAnalyzing}
          canRefine={Boolean(photoFile && vision.enabled)}
          isRefining={isRefining}
          onChooseView={chooseView}
          onChooseTurnVideo={chooseTurnVideo}
          onCaptureModeChange={(mode) => {
            setCaptureMode(mode);
            setViewReports([]);
            setMultiViewConfidence(null);
            setAnalysis(null);
            setLandmarks(null);
            setGroups([]);
            setGeneratedValues({});
            setValues({});
            setNotice(
              mode === "guided"
                ? "Add left/right angles or a turn video, then analyze the face set."
                : "Quick photo mode selected. Run analysis again."
            );
          }}
          onSourceModeChange={changeSourceMode}
          onAnalyze={runAnalysis}
          onRefine={runVisionRefinement}
          onImageReady={setImageElement}
        />
        <AnalysisPanel
          landmarks={landmarks}
          analysis={analysis}
          styleAssessment={styleAssessment}
          error={error}
        />
        <OutputPanel
          template={template}
          presetName={presetName}
          likeness={likeness}
          preserveSculpt={preserveSculpt}
          outputMode={outputMode}
          permissionConfirmed={permissionConfirmed}
          dependencyIndexed={dependencyIndexed}
          dependencies={dependencies}
          raceRecommendations={raceRecommendations}
          featureTargets={featureTargets}
          appearanceChoices={environment?.appearanceChoices ?? []}
          selectedAppearance={selectedAppearance}
          playableRaces={playableRaces}
          sliderInventory={sliderInventory}
          presetReport={presetReport}
          onInspectPreset={() => postNative({ type: "inspect-preset" })}
          onChooseSliderInventory={chooseSliderInventory}
          onClearSliderInventory={() => {
            setSliderInventory(null);
            setNotice("Slider inventory cleared. FaceForge will write the EFM family only.");
          }}
          targetRace={targetRace}
          targetSex={targetSex}
          nativeAvailable={nativeAvailable}
          groups={groups}
          values={values}
          generatedValues={generatedValues}
          onChooseTemplate={chooseTemplate}
          onRequestTemplate={() => postNative({ type: "choose-template" })}
          onUseFreshFoundation={useFreshFoundation}
          onPresetNameChange={setPresetName}
          onLikenessChange={setLikeness}
          onPreserveSculptChange={setPreserveSculpt}
          onOutputModeChange={(mode) => {
            setOutputMode(mode);
            if (mode === "follower-head-kit") setPreserveSculpt(true);
          }}
          onPermissionConfirmedChange={setPermissionConfirmed}
          onTargetRaceChange={setTargetRace}
          onTargetSexChange={setTargetSex}
          onFindBakedHead={() => postNative({ type: "find-baked-head", name: presetName })}
          onAppearanceChoice={(choice) => {
            setAppearanceSelections((current) => {
              if (current[choice.category]?.formIdentifier === choice.formIdentifier) {
                const next = { ...current };
                delete next[choice.category];
                return next;
              }
              return { ...current, [choice.category]: choice };
            });
          }}
          onSliderChange={changeSlider}
          onResetGroup={resetGroup}
        />
      </main>
      <footer className="status-rail">
        <div className="privacy-status">
          <MonitorIcon />
          <span>
            {vision.enabled ? "Local-first" : "On-device"}
            <i />
            {vision.enabled ? "upload only when Refine is pressed" : "photos never leave this PC"}
          </span>
        </div>
        <div className={`status-message ${error ? "error" : ""}`}>
          {notice}
          {visionResult?.observations[0] ? ` ${visionResult.observations[0]}` : ""}
        </div>
        <button
          type="button"
          className="export-button"
          onClick={exportPackage}
          disabled={!canExport}
        >
          <DownloadIcon />
          {outputMode === "follower-head-kit"
            ? "Export Head Kit"
            : outputMode === "racemenu-export-stage"
              ? "Export RaceMenu Head Stage"
              : "Export Preset Pack"}
        </button>
      </footer>
      {settingsOpen && (
        <AboutModal
          environment={environment}
          isIndexing={isIndexing}
          nativeAvailable={nativeAvailable}
          vision={vision}
          providerStatuses={providerStatuses}
          onVisionChange={setVision}
          onIndex={() => postNative({ type: "index-environment" })}
          onLoadIndexedPreset={(id) => postNative({ type: "load-indexed-template", id })}
          onConnectProvider={(provider) =>
            postNative({ type: "connect-vision-provider", provider })
          }
          onOpenProviderDocs={(provider) =>
            postNative({ type: "open-vision-provider-docs", provider })
          }
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
