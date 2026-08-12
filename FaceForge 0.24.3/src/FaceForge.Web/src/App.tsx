import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AboutModal, { type VisionSettings } from "./components/AboutModal";
import AnalysisPanel from "./components/AnalysisPanel";
import Header from "./components/Header";
import { DownloadIcon, MonitorIcon } from "./components/Icons";
import OutputPanel, { type OutputMode } from "./components/OutputPanel";
import SourcePanel from "./components/SourcePanel";
import {
  EFM_RANGE,
  NO_CORRECTION_NEEDED,
  assessAnalysisReliability,
  createNeutralEfmSliders,
  generateEfmSliders,
  measureFace,
  measurementBaselines,
  normalizeStylizedAnalysis,
  recommendFeatureTargets,
  raceFoundationFor,
  recommendRaceFoundations,
  recommendShapeStyles,
  shapeStyleDefinition,
  sliderRecord,
  type FaceAnalysis,
  type FaceLandmark,
  type AnalysisReliability,
  type ShapeStyleId,
  type SliderGroup
} from "./domain/faceAnalysis";
import {
  assessImageStyle,
  type SourceMode,
  type StyleAssessment
} from "./domain/imageStyle";
import {
  analyzePortraitUpright,
  blendshapeMap,
  detectFaceRobustly,
  selectPrimaryFace,
  withPrimaryFaceFirst
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
  AUTO_PREFER_CATEGORIES,
  describeInstallHeadCapabilities,
  preferHeadPart
} from "./domain/headPartPreferences";
import {
  hphCalibrationNotes,
  selectedFaceIsHighPolyHead
} from "./domain/hphCalibration";
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
  resolveMorphAvailability,
  inertDefinitions,
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
  const [analysisReliability, setAnalysisReliability] =
    useState<AnalysisReliability | null>(null);
  const pendingVisionMode = useRef<AnalysisReliability["mode"]>("refine");
  const [groups, setGroups] = useState<SliderGroup[]>([]);
  const [generatedValues, setGeneratedValues] = useState<Record<string, number>>({});

  // The analysis panel shows five of the thirty-nine measurements, which is right for a user and
  // useless for calibration. Exposing the whole record is what lets a render of the neutral Skyrim
  // head be measured by this exact pipeline, so the baselines it is compared against come from the
  // same code rather than from an estimate. See qa/calibrate-baselines.mjs.
  // The baselines go with it because a contaminated measurement is reported faded toward its
  // baseline, and undoing that fade -- which is what recovers a usable number from a render whose
  // eyes read as narrowed -- needs the exact table the running build faded against.
  useEffect(() => {
    const scope = window as unknown as {
      faceForge?: { analysis: FaceAnalysis | null; baselines: Record<string, number> };
    };
    scope.faceForge = { analysis, baselines: measurementBaselines };
  }, [analysis]);
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
  // Optional light male/female baseline nudge. Off by default so the photo stays authoritative.
  const [sexTouchUp, setSexTouchUp] = useState(false);
  // Optional geometry style (not ethnicity). Off by default.
  const [shapeStyle, setShapeStyle] = useState<ShapeStyleId>("none");
  const [targetRace, setTargetRace] = useState<string | null>(null);
  /** Categories the user manually toggled; auto-prefer must not overwrite those. */
  const [manualAppearanceCategories, setManualAppearanceCategories] = useState<
    Set<AppearanceChoice["category"]>
  >(() => new Set());
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
  const highPolyHeadActive = useMemo(
    () => selectedFaceIsHighPolyHead(Object.values(appearanceSelections).filter(Boolean) as AppearanceChoice[]),
    [appearanceSelections]
  );

  /**
   * What this installation can actually move on the head being targeted. Recomputed when the head
   * or race changes, because a slider that works on the vanilla mesh can be inert on High Poly
   * Head and vice versa.
   */
  const morphAvailability = useMemo(
    () =>
      resolveMorphAvailability(environment?.morphRegistry, {
        sex: targetSex,
        highPolyHead: highPolyHeadActive,
        raceEditorId: targetRace
      }),
    [environment, targetSex, highPolyHeadActive, targetRace]
  );

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
        setManualAppearanceCategories(new Set());
        setIsIndexing(false);
        setError(null);
        const headNotes = describeInstallHeadCapabilities(indexed.appearanceChoices);
        setNotice(
          `${indexed.autoDetected ? "Automatically indexed" : "Indexed"} ${indexed.sourceModCount.toLocaleString()} source mods, ${indexed.pluginCount.toLocaleString()} plugins, ${indexed.presetCount.toLocaleString()} CharGen presets, ${indexed.appearanceChoices.length.toLocaleString()} exact head-part records, and ${indexed.playableRaces.length} playable races. ${headNotes[0] ?? ""}`
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
        // baked head can be packaged together as something FollowerForge can actually consume.
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
        const interpretation = pendingVisionMode.current === "interpret";
        setVisionResult(result);
        setGeneratedValues((current) => {
          const neutralGroups = createNeutralEfmSliders();
          const baseline =
            !interpretation && Object.keys(current).length > 0
              ? current
              : sliderRecord(neutralGroups);
          if (interpretation || Object.keys(current).length === 0) setGroups(neutralGroups);
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
          `Vision ${interpretation ? "rebuilt the face from neutral" : "refined the local face"} with ${Object.keys(result.sliderDeltas).length} bounded Skyrim controls at ${Math.round(result.confidence * 100)}% model confidence.`
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
    setAnalysisReliability(null);
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
          // Same recovery ladder as still photos: multi-face frames keep the primary subject
          // instead of being discarded, and weak/rotated frames get a second chance.
          const attempt = await detectFaceRobustly(canvas);
          if (!attempt) continue;
          const result = withPrimaryFaceFirst(
            attempt.result,
            selectPrimaryFace(attempt.result)
          );
          const frame =
            attempt.image instanceof HTMLCanvasElement ? attempt.image : canvas;
          const detected = result.faceLandmarks[0] as readonly FaceLandmark[];
          const quality = measureImageQuality(
            frame,
            frame.width,
            frame.height,
            detected
          );
          candidates.push({
            value: await canvasFile(
              frame,
              `${file.name.replace(/\.[^.]+$/, "")}-frame-${index + 1}.jpg`
            ),
            yaw: signedYawOffset(detected, frame.width / frame.height),
            quality: quality.score
          });
        }
        const selected = selectVideoViews(candidates);
        if (!selected.front)
          throw new Error("No usable face was found in the turn video.");
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
        // detectFaceRobustly + withPrimaryFaceFirst already picked the subject when several faces
        // were present. Reject only a true empty detection.
        if (result.faceLandmarks.length === 0) {
          if (source.role === "front") {
            if (assessedStyle.kind === "stylized")
              throw new Error(
                "The illustration was recognized as stylized, but the local landmark model could not map it. Enable vision refinement to build the 35-slider Skyrim interpretation from neutral."
              );
            throw new Error(
              "No face was detected. Try a clearer front-facing portrait, brighter lighting, or a tighter crop."
            );
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
            warnings: ["No face was detected."]
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
          sourceAspectRatio,
          upright.occlusion
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
          upright.recoveryStrategy
            ? `Face found ${upright.recoveryStrategy}.`
            : null,
          upright.candidateFaces > 1
            ? `Chose the primary face from ${upright.candidateFaces} detected faces (largest and most central).`
            : null,
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
      const generatedGroups = generateEfmSliders(
        measured,
        sliderInventory,
        targetRace,
        targetSex,
        sexTouchUp,
        shapeStyle,
        highPolyHeadActive,
        morphAvailability
      );
      const generated = sliderRecord(generatedGroups);
      const reliability = assessAnalysisReliability(
        measured,
        assessedStyle.kind === "stylized",
        captureMode === "guided" ? fused.confidence : front.report.score,
        generated
      );
      setLandmarks(frontLandmarks);
      setAnalysis(measured);
      setAnalysisReliability(reliability);
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
      const hphNotes = hphCalibrationNotes(highPolyHeadActive);
      // Sliders this head cannot move are dropped rather than written as dead keys, but silently
      // dropping a third of the face would be its own kind of lie -- so say which and why.
      const inert = inertDefinitions(sliderInventory, morphAvailability);
      const inertNote =
        inert.length > 0 && morphAvailability
          ? ` ${inert.length} slider${inert.length === 1 ? "" : "s"} were left out: this ` +
            `${morphAvailability.highPoly ? "High Poly Head" : "head"} mesh has ` +
            `${morphAvailability.headVertexCount} vertices and the mods defining them ship morphs ` +
            `for a different vertex count, so they move nothing.`
          : "";
      setNotice(
        (reliability.mode === "interpret"
          ? `Local analysis finished but is not reliable enough to guide vision. The editable local values remain available; optional vision will interpret the face from neutral. ${reliability.reasons[0]}`
          : heldSliders > 0
          ? `Analysis complete. ${heldSliders} slider${heldSliders === 1 ? " was" : "s were"} left at neutral because the source could not measure them; everything else was pose-corrected.${hphNotes[0] ? ` ${hphNotes[0]}` : ""}`
          : measured.correction.notes.length > 0
            ? `Analysis complete. Tilt, turn, and left/right differences were corrected before measuring.${hphNotes[0] ? ` ${hphNotes[0]}` : ""}`
            : assessedStyle.kind === "stylized"
              ? "Stylized face interpreted and normalized toward believable Skyrim anatomy. Review the editable values."
              : `Local photo analysis complete.${hphNotes[0] ? ` ${hphNotes[0]}` : " Review the editable values or use optional vision refinement."}`) + inertNote
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Face analysis failed.";
      setError(message);
      setNotice(message);
      setLandmarks(null);
      setAnalysis(null);
      setAnalysisReliability(null);
      setViewReports([]);
      setMultiViewConfidence(null);
      setGroups([]);
      setGeneratedValues({});
      setValues({});
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    captureMode,
    imageElement,
    morphAvailability,
    sideViews,
    sliderInventory,
    sourceMode,
    targetRace,
    targetSex,
    sexTouchUp,
    shapeStyle,
    highPolyHeadActive
  ]);

  const changeSourceMode = useCallback((mode: SourceMode) => {
    setSourceMode(mode);
    setStyleAssessment(null);
    setLandmarks(null);
    setAnalysis(null);
    setAnalysisReliability(null);
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
      const visionMode = analysis
        ? analysisReliability?.mode ??
          (assessedStyle.kind === "stylized" ? "interpret" : "refine")
        : "interpret";
      pendingVisionMode.current = visionMode;
      setIsRefining(true);
      setError(null);
      setNotice(
        `Preparing a reduced portrait for one-time vision ${visionMode === "interpret" ? "interpretation" : "refinement"}…`
      );
      const imageDataUrl = await resizeImageForVision(photoFile);
      postNative({
        type: "vision-analyze",
        provider: vision.provider,
        apiKey: vision.apiKey,
        model: vision.model.trim(),
        consent: vision.consent,
        sourceKind: assessedStyle.kind,
        analysisMode: visionMode,
        hasLocalAnalysis: visionMode === "refine",
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
    analysisReliability,
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
        selectedAppearance,
        { highPolyHead: highPolyHeadActive, targetSex }
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
    highPolyHeadActive,
    targetRace,
    targetSex,
    template,
    values
  ]);

  const raceRecommendations = useMemo(
    () => (analysis ? recommendRaceFoundations(analysis) : []),
    [analysis]
  );
  const shapeStyleRecommendations = useMemo(
    () => (analysis ? recommendShapeStyles(analysis) : []),
    [analysis]
  );
  const featureTargets = useMemo(
    () => (analysis ? recommendFeatureTargets(analysis) : []),
    [analysis]
  );
  const playableRaces = environment?.playableRaces ?? [];

  // A slider is an offset from the chosen race's head, so changing the race changes every value
  // that race defines a proportion for. Regenerate from the analysis already in hand rather than
  // making the user re-run detection.
  const regeneratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!analysis || groups.length === 0) {
      // Next successful analysis must seed the key again, or a later race change would no-op.
      regeneratedFor.current = null;
      return;
    }
    const key = `${targetRace ?? ""}|${targetSex}|${sexTouchUp ? "sex" : "plain"}|${shapeStyle}|${
      highPolyHeadActive ? "hph" : "std"
    }|${sliderInventory?.fileName ?? ""}`;
    if (regeneratedFor.current === null) {
      regeneratedFor.current = key;
      return;
    }
    if (regeneratedFor.current === key) return;
    regeneratedFor.current = key;
    const next = generateEfmSliders(
      analysis,
      sliderInventory,
      targetRace,
      targetSex,
      sexTouchUp,
      shapeStyle,
      highPolyHeadActive,
      morphAvailability
    );
    const values = sliderRecord(next);
    setGroups(next);
    setGeneratedValues(values);
    setValues(values);
    const foundation = raceFoundationFor(targetRace);
    const sexNote = sexTouchUp
      ? targetSex === "male"
        ? " Light male touch-up on (a bit more jaw/brow, slightly firmer eyes)."
        : " Light female touch-up on (softer jaw, slightly larger eyes/lips)."
      : "";
    const styleDef = shapeStyleDefinition(shapeStyle);
    const styleNote = styleDef ? ` Shape style: ${styleDef.label}.` : "";
    // 0.16.0/0.17.0 did raise the HPH response and add midface baseline factors, and 0.18.0
    // withdrew both -- HPH_RESPONSE_GAIN is now identical to the standard gain and
    // HPH_BASELINE_FACTORS is empty. This line kept advertising them for six releases.
    const hphNote = highPolyHeadActive
      ? " High Poly Head detected: sculpt hosts are declared for its topology, and slider response is the same as a vanilla head (no HPH-specific gain — the mesh has not been measured)."
      : "";
    setNotice(
      foundation
        ? `Sliders rebuilt as offsets from the ${foundation.race} head. Values that race defines a proportion for have changed; the rest are unaffected.${sexNote}${styleNote}${hphNote}`
        : `Sliders rebuilt against the generic baseline; no installed race proportions were applied.${sexNote}${styleNote}${hphNote}`
    );
  }, [
    analysis,
    groups.length,
    sliderInventory,
    targetRace,
    targetSex,
    sexTouchUp,
    shapeStyle,
    highPolyHeadActive
  ]);

  const applyShapeStyle = useCallback(
    (id: ShapeStyleId) => {
      setShapeStyle(id);
      if (id === "none" || playableRaces.length === 0) return;
      const style = shapeStyleDefinition(id);
      if (!style) return;
      // Prefer the first preferred race that is actually installed; leave the user's race alone
      // when none of them are present.
      for (const raceName of style.preferredRaces) {
        const matched = matchInstalledRace(raceName, playableRaces);
        if (matched) {
          setTargetRace(matched.editorId);
          break;
        }
      }
    },
    [playableRaces]
  );

  // Pre-select the best-ranked race once, but only if it exists as an installed RACE record.
  // The user stays free to change it; head-part filtering follows whatever is chosen here.
  useEffect(() => {
    if (targetRace || raceRecommendations.length === 0 || playableRaces.length === 0) return;
    const matched = matchInstalledRace(raceRecommendations[0].race, playableRaces);
    if (matched) setTargetRace(matched.editorId);
  }, [playableRaces, raceRecommendations, targetRace]);

  // Once the index knows the install, prefer High Poly Head (and HPH-linked brows) for the
  // active race/sex. Manual picks in those categories are left alone.
  useEffect(() => {
    const choices = environment?.appearanceChoices;
    if (!choices || choices.length === 0) return;
    setAppearanceSelections((current) => {
      let changed = false;
      const next = { ...current };
      for (const category of AUTO_PREFER_CATEGORIES) {
        if (manualAppearanceCategories.has(category)) continue;
        const preferred = preferHeadPart(choices, category, targetRace, targetSex);
        if (!preferred) {
          if (next[category]) {
            delete next[category];
            changed = true;
          }
          continue;
        }
        if (next[category]?.formIdentifier !== preferred.formIdentifier) {
          next[category] = preferred;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [
    environment?.appearanceChoices,
    targetRace,
    targetSex,
    manualAppearanceCategories
  ]);

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
          visionMode={
            analysisReliability?.mode ??
            (styleAssessment?.kind === "stylized" ? "interpret" : "refine")
          }
          onChooseView={chooseView}
          onChooseTurnVideo={chooseTurnVideo}
          onCaptureModeChange={(mode) => {
            setCaptureMode(mode);
            setViewReports([]);
            setMultiViewConfidence(null);
            setAnalysis(null);
            setAnalysisReliability(null);
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
          reliability={analysisReliability}
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
          shapeStyleRecommendations={shapeStyleRecommendations}
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
          sexTouchUp={sexTouchUp}
          shapeStyle={shapeStyle}
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
          onSexTouchUpChange={setSexTouchUp}
          onShapeStyleChange={applyShapeStyle}
          onFindBakedHead={() => postNative({ type: "find-baked-head", name: presetName })}
          onAppearanceChoice={(choice) => {
            setManualAppearanceCategories((current) => {
              const next = new Set(current);
              next.add(choice.category);
              return next;
            });
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
