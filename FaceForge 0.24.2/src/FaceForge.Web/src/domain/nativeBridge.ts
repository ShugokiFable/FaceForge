export interface IndexedPreset {
  id: string;
  fileName: string;
  layout: string;
  requiredPlugins: string[];
  sculptHostCount: number;
  hasNif: boolean;
  hasDds: boolean;
}

export interface EnvironmentSummary {
  gameDataPath: string;
  detectionMethod: string;
  autoDetected: boolean;
  manifestPath: string | null;
  stagingPath: string | null;
  deploymentTimeUtcMs: number;
  sourceModCount: number;
  pluginCount: number;
  relevantAssetCount: number;
  bsaCount: number;
  presetCount: number;
  presets: IndexedPreset[];
  appearanceRecommendations: AppearanceRecommendation[];
  appearanceChoices: AppearanceChoice[];
  playableRaces: PlayableRace[];
  morphRegistry: MorphRegistrySnapshot;
}

export interface MorphPartInfo {
  chargenTriPath: string;
  vertexCount: number;
  morphCount: number;
  error: string | null;
}

export interface MorphExtensionInfo {
  extensionPath: string;
  plugin: string;
  vertexCount: number;
  topologyMatches: boolean;
  morphCount: number;
  rejection: string | null;
}

export interface HeadMorphProfile {
  chargenTriPath: string;
  targetSex: string;
  highPoly: boolean;
  vertexCount: number;
  morphNames: string[];
  parts: MorphPartInfo[];
  extensions: MorphExtensionInfo[];
  error: string | null;
}

export interface MorphSliderEntry {
  name: string;
  negativeMorph: string;
  positiveMorph: string;
}

export interface MorphSliderSet {
  plugin: string;
  iniPath: string;
  sex: string;
  races: string[];
  sliders: MorphSliderEntry[];
}

/**
 * What the installation can actually move, read from its own facegenmorphs inis and .tri files.
 * A RaceMenu slider appears whenever a race registers it, but only moves the face when its morph
 * pair exists in a mesh matching the worn head's vertex count -- see FaceForge.Core/MorphRegistry.
 */
export interface MorphRegistrySnapshot {
  heads: HeadMorphProfile[];
  sliderSets: MorphSliderSet[];
  /**
   * False when an installed archive declares facegenmorphs content the loose-file read cannot
   * open. A partial registry can prove a slider live; it can never prove one dead.
   */
  complete: boolean;
  unreadArchives: string[];
}

export interface AppearancePluginRequirement {
  pluginName: string;
  masters: string[];
  missingMasters: string[];
}

export interface AppearanceRecommendation {
  category: "brows" | "eyes" | "hair";
  sourceMod: string;
  confidenceScore: number;
  assetCount: number;
  sourceBsaCount: number;
  evidencePaths: string[];
  pluginRequirements: AppearancePluginRequirement[];
  compatibilityNotes: string[];
}

/** Categories come from the HDPT Type subrecord, so every Skyrim head-part type can appear. */
export type AppearanceCategory =
  | "brows"
  | "eyes"
  | "hair"
  | "facialhair"
  | "scars"
  | "face"
  | "misc";

/** From the HDPT Male/Female flags. "unflagged" means Skyrim does not restrict the record. */
export type AppearanceSex = "male" | "female" | "any" | "unflagged";

export interface AppearanceChoice {
  category: AppearanceCategory;
  displayName: string;
  editorId: string | null;
  formIdentifier: string;
  pluginName: string;
  sourceMod: string | null;
  masters: string[];
  missingMasters: string[];
  matchEvidence: string;
  sex: AppearanceSex;
  playable: boolean;
  /** EditorID of the ValidRaces form list, when it resolved against installed plugins. */
  validRacesEditorId: string | null;
  /** RACE EditorIDs the part is valid for. Empty means unresolved, never "valid for none". */
  validRaces: string[];
  /** False when the record had no Type subrecord and the category was guessed from its name. */
  typeFromRecord: boolean;
}

export interface MorphFamilyCount {
  family: string;
  count: number;
}

export interface PresetHeadPartReport {
  formIdentifier: string;
  displayName: string | null;
  editorId: string | null;
  category: string;
  sex: string;
  validRaces: string[];
  pluginName: string;
  sourceMod: string | null;
  /** False when the FormID is not among the indexed HDPT records on this machine. */
  resolved: boolean;
}

/** What a finished preset needs, recomputed from the file rather than from export time. */
export interface PresetReport {
  fileName: string;
  fullPath: string;
  customMorphCount: number;
  morphFamilies: MorphFamilyCount[];
  sculptHosts: string[];
  headParts: PresetHeadPartReport[];
  dependencies: PluginProvider[];
  tintLayerCount: number;
  hairColor: number | null;
  weight: number;
  headTexture: string | null;
  hasVanillaBase: boolean;
  shareReady: boolean;
  blockers: string[];
  notes: string[];
}

export interface PlayableRace {
  editorId: string;
  name: string | null;
  formIdentifier: string;
  faceGenHead: boolean;
}

export interface PluginProvider {
  pluginName: string;
  sourceMod: string | null;
  present: boolean;
  baseGame: boolean;
  sourceBsaCount: number;
  sourceRelevantAssetCount: number;
}

export interface VisionResult {
  model: string;
  confidence: number;
  observations: string[];
  sliderDeltas: Record<string, number>;
}

export interface CliProviderStatus {
  id: string;
  displayName: string;
  installed: boolean;
  executablePath: string | null;
  accountLabel: string;
  documentationUrl: string;
}

export interface TemplatePayload {
  fileName: string;
  contents: string;
  sourceId: string | null;
  nifPath: string | null;
  ddsPath: string | null;
  layout: string;
}

export interface ExportResult {
  outputPath: string;
  mode: string;
  fileCount: number;
  sha256: string;
  entries: string[];
}

export interface NativeEnvelope {
  type: string;
  payload: unknown;
}

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage: (message: unknown) => void;
        addEventListener: (
          type: "message",
          listener: (event: MessageEvent<NativeEnvelope>) => void
        ) => void;
        removeEventListener: (
          type: "message",
          listener: (event: MessageEvent<NativeEnvelope>) => void
        ) => void;
      };
    };
  }
}

export const hasNativeBridge = () => Boolean(window.chrome?.webview);

export const postNative = (message: Record<string, unknown>): boolean => {
  const bridge = window.chrome?.webview;
  if (!bridge) return false;
  bridge.postMessage(message);
  return true;
};

export const subscribeNative = (
  listener: (message: NativeEnvelope) => void
): (() => void) => {
  const bridge = window.chrome?.webview;
  if (!bridge) return () => undefined;
  const handler = (event: MessageEvent<NativeEnvelope>) => listener(event.data);
  bridge.addEventListener("message", handler);
  return () => bridge.removeEventListener("message", handler);
};

export async function resizeImageForVision(file: File): Promise<string> {
  if (file.size > 25_000_000) throw new Error("Choose an image smaller than 25 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the photo for vision analysis.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    bitmap.close();
  }
}
