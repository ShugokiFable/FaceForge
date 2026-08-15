import { postNative, subscribeNative } from "./nativeBridge";
import {
  analyzePortrait,
  blendshapeMap,
  selectPrimaryFace,
  withPrimaryFaceFirst
} from "./mediapipe";
import { measureFace, type FaceAnalysis, type FaceLandmark } from "./faceAnalysis";

/**
 * Bridge to the native head renderer. The desktop host renders the player's actual chargen head --
 * the real .tri meshes from the indexed install, with race and EFM slider morphs applied -- and
 * returns PNG data URLs. The frontend then measures those renders with the very same MediaPipe +
 * measureFace pipeline it uses on photos, which is what makes the "Analyze & improve" loop a
 * closed loop instead of the old one-shot slider formula.
 */

export interface RenderTargetMeta {
  sex: "male" | "female";
  highPoly: boolean;
  race: string | null;
  size?: number;
}

export interface RenderRequest {
  id: string;
  sliders: Record<string, number>;
  /** Turn about the vertical axis in degrees; 0 = front. */
  yaw?: number;
  /** Total pitch in degrees; omit to use the calibrated frontal pitch for the head. */
  pitch?: number;
  /** Texture the head with the installed skin (for the preview); the fit leaves this off for speed. */
  textured?: boolean;
  /** Sculpt reshape (what the EFM morphs cannot do): scale head width about the centroid; 1 = unchanged, <1 narrows/elongates. */
  faceWidthScale?: number;
  /** Sculpt reshape: scale head height about the centroid; 1 = unchanged, >1 lengthens. */
  faceHeightScale?: number;
  /** Sculpt reshape: push the nose forward (profile projection) as a fraction of head height. 0 = unchanged. */
  noseForward?: number;
  /** Sculpt reshape: lift the lower face (jaw/chin) up as a fraction of head height. 0 = unchanged; >0 shortens the lower face. */
  jawRaise?: number;
}

let requestCounter = 0;
const nextRequestId = () => `render-${Date.now()}-${requestCounter++}`;

/**
 * Sentinel slider keys that carry the sculpt reshape (face width/height scale, nose-forward) rather
 * than a real EFM morph. They ride inside the slider record so the fit can drive them and every
 * preview/vision render applies them; the export converts them to sculpt deltas and never writes them
 * as morphs. The EFM morphs cannot elongate a round head or project the nose -- the reshape can.
 */
export const RESHAPE_KEYS = ["__FaceWidthScale", "__FaceHeightScale", "__NoseForward", "__JawHeight"] as const;

export interface ReshapeParams {
  faceWidthScale: number;
  faceHeightScale: number;
  noseForward: number;
  jawRaise: number;
}

export const NEUTRAL_RESHAPE: ReshapeParams = { faceWidthScale: 1, faceHeightScale: 1, noseForward: 0, jawRaise: 0 };

/**
 * Maps the sentinel fit-variable values (EFM-like units, ~[-3,3]) to renderer reshape params. Gains
 * were calibrated offline so the reachable range covers the measured targets: width to ~0.79 (front
 * aspect 1.07 -> 1.23, past the ~1.10 morph ceiling) and nose-forward to ~0.09 (profile projection
 * 0.069 -> 0.11, matching the photo).
 */
export function reshapeParamsFromSliders(sliders: Record<string, number>): ReshapeParams {
  return {
    faceWidthScale: 1 + (sliders.__FaceWidthScale ?? 0) * 0.07,
    faceHeightScale: 1 + (sliders.__FaceHeightScale ?? 0) * 0.05,
    // Nose-forward: positive projects the nose, negative pulls it IN. The pull-in range matters most
    // (the base HPH nose reads too projected for a refined nose), so the gain is 0.015 -> value -3
    // pulls the nose in ~0.045 of head height. The auto-fit target is down-weighted separately so it
    // does not over-project on the positive side.
    noseForward: (sliders.__NoseForward ?? 0) * 0.015,
    jawRaise: (sliders.__JawHeight ?? 0) * 0.03
  };
}

/** The slider record with the reshape sentinels removed (the real EFM morphs only). */
export function withoutReshape(sliders: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(sliders)) {
    if (!(RESHAPE_KEYS as readonly string[]).includes(key)) out[key] = sliders[key];
  }
  return out;
}

/** A RenderRequest that applies the reshape carried in the slider record and strips the sentinels. */
export function reshapedRenderRequest(
  id: string,
  sliders: Record<string, number>,
  extra: { yaw?: number; pitch?: number; textured?: boolean } = {}
): RenderRequest {
  const reshape = reshapeParamsFromSliders(sliders);
  return {
    id,
    sliders: withoutReshape(sliders),
    yaw: extra.yaw ?? 0,
    ...(extra.pitch === undefined ? {} : { pitch: extra.pitch }),
    ...(extra.textured ? { textured: true } : {}),
    faceWidthScale: reshape.faceWidthScale,
    faceHeightScale: reshape.faceHeightScale,
    noseForward: reshape.noseForward,
    jawRaise: reshape.jawRaise
  };
}

/**
 * Renders a batch of (slider set, pose) requests in one native round trip and resolves a map of
 * request id -> PNG data URL. Requests whose head could not be resolved are simply absent.
 */
export function renderHeads(
  meta: RenderTargetMeta,
  requests: RenderRequest[],
  timeoutMs = 30000
): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("The head renderer did not respond in time."));
    }, timeoutMs);

    const unsubscribe = subscribeNative((message) => {
      if (message.type !== "heads-rendered") return;
      const payload = message.payload as {
        requestId?: string;
        images?: { id: string; dataUrl: string }[];
        error?: string;
      };
      if (payload.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      if (payload.error) {
        reject(new Error(payload.error));
        return;
      }
      const map = new Map<string, string>();
      for (const image of payload.images ?? []) map.set(image.id, image.dataUrl);
      resolve(map);
    });

    const posted = postNative({
      type: "render-heads",
      requestId,
      sex: meta.sex,
      highPoly: meta.highPoly,
      race: meta.race,
      size: meta.size ?? 384,
      requests: requests.map((request) => ({
        id: request.id,
        sliders: request.sliders,
        yaw: request.yaw ?? 0,
        ...(request.pitch === undefined ? {} : { pitch: request.pitch }),
        ...(request.textured ? { textured: true } : {}),
        ...(request.faceWidthScale === undefined ? {} : { faceWidthScale: request.faceWidthScale }),
        ...(request.faceHeightScale === undefined ? {} : { faceHeightScale: request.faceHeightScale }),
        ...(request.noseForward === undefined ? {} : { noseForward: request.noseForward }),
        ...(request.jawRaise === undefined ? {} : { jawRaise: request.jawRaise })
      }))
    });
    if (!posted) {
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      reject(new Error("The native head renderer is only available in the desktop app."));
    }
  });
}

/** One head part's RaceMenu sculpt: the host tri, its vertex count, and [index, dx, dy, dz] per moved vertex. */
export interface SculptEntry {
  host: string;
  vertices: number;
  data: number[][];
}

export interface SculptResult {
  divisor: number;
  entries: SculptEntry[];
}

/**
 * Asks the native side to convert the sculpt reshape carried in the slider record (face width/height,
 * nose-forward, jaw-lift sentinels) into per-vertex RaceMenu sculpt deltas for the head, eyes and brows.
 * The export writes these into the preset's morphs.sculpt so the elongation / nose / jaw the preview
 * shows actually appear in-game. Resolves to empty in the browser (no native renderer).
 */
export function computeSculpt(
  meta: RenderTargetMeta,
  sliders: Record<string, number>,
  timeoutMs = 30000
): Promise<SculptResult> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("The sculpt computation did not respond in time."));
    }, timeoutMs);

    const unsubscribe = subscribeNative((message) => {
      if (message.type !== "sculpt-computed") return;
      const payload = message.payload as {
        requestId?: string;
        sculpt?: SculptEntry[];
        divisor?: number;
        error?: string;
      };
      if (payload.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      if (payload.error) {
        reject(new Error(payload.error));
        return;
      }
      resolve({ divisor: payload.divisor ?? 10000, entries: payload.sculpt ?? [] });
    });

    const reshape = reshapeParamsFromSliders(sliders);
    const posted = postNative({
      type: "compute-sculpt",
      requestId,
      sex: meta.sex,
      highPoly: meta.highPoly,
      race: meta.race,
      sliders: withoutReshape(sliders),
      faceWidthScale: reshape.faceWidthScale,
      faceHeightScale: reshape.faceHeightScale,
      noseForward: reshape.noseForward,
      jawRaise: reshape.jawRaise
    });
    if (!posted) {
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      reject(new Error("The native head renderer is only available in the desktop app."));
    }
  });
}

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A rendered head image could not be decoded."));
    image.src = dataUrl;
  });

/**
 * Runs the standard detector + measurement pipeline on a rendered head, so its geometry is described
 * in exactly the same measurement space as an uploaded photo. Returns null when no face is detected
 * in the render (which the caller should treat as "this candidate is unusable", not an error).
 */
export async function measureRenderDataUrl(dataUrl: string): Promise<FaceAnalysis | null> {
  const image = await loadImage(dataUrl);
  const result = await analyzePortrait(image);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const ordered = withPrimaryFaceFirst(result, selectPrimaryFace(result));
  const landmarks = ordered.faceLandmarks[0];
  if (!landmarks || landmarks.length < 468) return null;
  const aspect = image.naturalWidth > 0 && image.naturalHeight > 0
    ? image.naturalWidth / image.naturalHeight
    : 1;
  try {
    return measureFace(landmarks, blendshapeMap(ordered), aspect, null);
  } catch {
    return null;
  }
}

/**
 * The raw (uncorrected) landmarks + image aspect for a data URL or object URL, for measurements the
 * front measureFace pipeline discards -- specifically lateral nose projection, which must be read off
 * the turned face rather than a front-normalized mesh. Returns null when no face is detected.
 */
export async function rawLandmarksFromDataUrl(
  url: string
): Promise<{ landmarks: FaceLandmark[]; aspect: number } | null> {
  const image = await loadImage(url);
  const result = await analyzePortrait(image);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const ordered = withPrimaryFaceFirst(result, selectPrimaryFace(result));
  const landmarks = ordered.faceLandmarks[0];
  if (!landmarks || landmarks.length < 468) return null;
  const aspect =
    image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  return { landmarks, aspect };
}
