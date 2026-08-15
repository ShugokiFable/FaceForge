import { MEASUREMENT_KEYS, noseProjection, type FaceAnalysis, type MeasurementKey } from "./faceAnalysis";
import {
  measureRenderDataUrl,
  rawLandmarksFromDataUrl,
  renderHeads,
  reshapedRenderRequest,
  RESHAPE_KEYS,
  type RenderTargetMeta
} from "./headRender";

/**
 * The "Analyze & improve" optimiser.
 *
 * Instead of the old one-shot transfer function (each slider driven by one measurement through a
 * hand-tuned gain), this measures how the player's ACTUAL head responds to each slider -- by
 * rendering the real chargen head with that slider perturbed and measuring the render -- and then
 * inverts that measured response to hit the proportions read from the photos. That is a closed loop
 * against the true geometry, which is what fixes the "proportions don't match the sliders" problem.
 *
 * The forward evaluation renders frontally (measurement space is pose-normalised) and measures with
 * the same MediaPipe pipeline the photos use, so render and target are directly comparable.
 */

/** The EFM sliders the optimiser is allowed to move (the ±3 expressive-morph set). */
export const EFM_FIT_SLIDERS: readonly string[] = [
  "EFM_Brow_Angle", "EFM_Brow_Height", "EFM_Brow_Width", "EFM_Brow_Angle",
  "EFM_Cheek_Height", "EFM_Cheek_Width", "EFM_Cheek_Depth", "EFM_Cheek_Shape",
  "EFM_Chin_Height", "EFM_Chin_Shape", "EFM_Chin_Width", "EFM_Chin_Depth",
  "EFM_Eyes_Height", "EFM_Eyes_Inner_Height", "EFM_Eyes_Lower_Height",
  "EFM_Eyes_Outer_Height", "EFM_Eyeground_Height", "EFM_Eyes_Size", "EFM_Eyes_Upper_Height",
  "EFM_Eyes_Width", "EFM_Eyes_Inner_Width", "EFM_Eyes_Outer_Width", "EFM_Eyeground_Width",
  "EFM_Eyes_Upper_Shape", "EFM_Eyes_Lower_Shape", "EFM_Eyelid_Upper", "EFM_Eyelid_Lower", 
  "EFM_Eyes_AO_Depth", "EFM_Eyes_Outer_Thickness", "EFM_Eyes_Inner_Thickness",
  "EFM_Eyeball_Width", "EFM_Eyeball_Height", "EFM_Eyeball_Depth", "EFM_Eyeball_Size", "EFM_Iris_Width",
  "EFM_Face_Height", "EFM_Face_Depth", "EFM_Jaw_Height", "EFM_Jaw_Width",
  "EFM_Lip_Angle", "EFM_Lip_Height", "EFM_Lip_Lower_Thickness",
  "EFM_Lip_Lower_Width", "EFM_Lip_Upper_Thickness", "EFM_Lip_Upper_Width",
  "EFM_Lip_Width", "EFM_Oral_Width", "EFM_Oral_Height", "EFM_Oral_Depth", 
  "EFM_Nose_Bridge_Width", "EFM_Nose_Bridge_Depth", "EFM_Nose_Height", "EFM_Nose_Depth", 
  "EFM_Nose_Root_Height", "EFM_Nose_Root_Width", "EFM_Nose_Size", "EFM_Nose_Tip_Height",
  "EFM_Nose_Tip_Width", "EFM_Nose_Tip_Thickness", "EFM_Nose_Tip_Depth", "EFM_Nose_Width", "EFM_Nose_Wing_Height",
  "EFM_Nose_Wing_Width", "EFM_Nose_Wing_Thickness", "EFM_Philtrum_Width", "EFM_Tubercle_Upper_Width", "EFM_Tubercle_Upper_Height",
  "EFM_Tubercle_Upper_Thickness", "EFM_Tubercle_Upper_Depth", "EFM_Tubercle_Lower_Width", 
  "EFM_Tubercle_Lower_Height", "EFM_Tubercle_Lower_Thickness", "EFM_Tubercle_Lower_Depth" 
];

/**
 * DEBUG TRACE toggle. 1 = the fit attaches a per-pass numeric trace to every FitProgress AND the app
 * saves each pass's render (`<name>_pass<N>_front/profile.png`) plus a markdown log (and, if a vision
 * provider is configured, an LM justification per pass). 0 = off, zero overhead. Flip this one constant
 * between app versions to turn the whole debug harness on or off.
 */
export const DEBUG = 1;

const EFM_LIMIT = 3;
const PERTURB = 1.0; // slider units used to probe each slider's measurement response
/** How much of the lateral-measured nose projection to aim for; <1 because the profile over-reads it. */
const NOSE_PROFILE_WEIGHT = 0.5;
/**
 * The AUTO nose-projection pass may only nudge projection within a NATURAL band: beyond ~1.0
 * (0.015*headSize) the nose deforms in either direction -- pushing OUT beaks (and stacks with railed EFM
 * nose morphs), pulling the base IN caves the mid-face. A little extra pull-in room is allowed because
 * the base HPH nose reads slightly over-projected, but not enough to cave it. The MANUAL "Nose forward"
 * slider keeps the full +/-3 range for deliberate control (with the realism penalty reflected in the score).
 */
const NOSE_AUTO_MAX_PUSH = 1.0;
const NOSE_AUTO_MAX_PULL = 1.5;
const clampNoseAuto = (value: number) => Math.max(-NOSE_AUTO_MAX_PULL, Math.min(NOSE_AUTO_MAX_PUSH, value));

/**
 * REALISM PRIOR. The front render is orthographic, so the measurement loss is blind to DEPTH: a nose
 * projected into a beak measures the same front loss as a flat one. Without a counter-pressure the
 * optimiser exploits that blindness -- it rails depth-projecting sliders (EFM nose length/height) and
 * the nose-forward reshape to satisfy a 2D (and often pose-corrupted) target while wrecking the profile,
 * and because the score can't see it, a re-run just re-converges to the same deformed state. This soft
 * hinge penalty, folded INTO the loss, makes a railed/deformed set score strictly worse -- so the LM
 * accept-test rejects those steps, the reported score reflects the deformation, and a re-run improves it.
 * It only bites past a comfortable magnitude, so an honest fit that needs a strong (but not railed)
 * morph is unaffected; the reshape sentinels distort faster, so they get a tighter band and more weight.
 */
const REALISM_EFM_SOFT = 2.2;    // EFM sliders may use up to here for free; rails are +/-3
const REALISM_EFM_WEIGHT = 0.02; // per-slider hinge weight, in measurement-loss units
const REALISM_RESHAPE_WEIGHT = 0.06;
const REALISM_RESHAPE_SOFT: Record<string, number> = {
  // Beyond ~1.0 (0.015*headSize) the nose stops reading natural at a steep profile in EITHER direction:
  // pushing OUT beaks, and pulling the base IN caves/flattens the mid-face. __NoseForward is only for
  // small projection nudges; reduce nose SIZE with EFM_Nose_Size, which shrinks the nose without caving.
  __NoseForward: 1.0,
  __JawHeight: 2.0,
  __FaceWidthScale: 2.4,
  __FaceHeightScale: 2.4
};

/** Soft-hinge realism penalty on a slider set, in the same units as the measurement loss. */
function realismPenalty(sliders: Record<string, number>): number {
  let penalty = 0;
  for (const key of Object.keys(sliders)) {
    const v = sliders[key] ?? 0;
    if (key in REALISM_RESHAPE_SOFT) {
      const over = Math.max(0, Math.abs(v) - REALISM_RESHAPE_SOFT[key]);
      penalty += REALISM_RESHAPE_WEIGHT * over * over;
    } else if (!(RESHAPE_KEYS as readonly string[]).includes(key)) {
      const over = Math.max(0, Math.abs(v) - REALISM_EFM_SOFT);
      penalty += REALISM_EFM_WEIGHT * over * over;
    }
  }
  return penalty;
}

export type Measurements = Partial<Record<MeasurementKey, number>>;

export interface FitTargets {
  /** Fused per-measurement target value across all reference photos. */
  values: Measurements;
  /** Fused per-measurement confidence (0-1), the weight each measurement carries in the loss. */
  weights: Measurements;
}

export interface FitProgress {
  iteration: number;
  totalIterations: number;
  loss: number;
  improved: boolean;
  sliders: Record<string, number>;
  /** The region being fitted this pass (staged coarse-to-fine, top-to-bottom). */
  label?: string;
  /** DEBUG TRACE (the numeric "why" of this pass): which sliders this stage was allowed to move, which
   * actually changed and by how much, the measurements it was answering to (target vs render), and the
   * realism penalty. This is the authoritative justification for a NUMERIC (Levenberg-Marquardt) pass. */
  trace?: FitPassTrace;
}

export interface FitPassTrace {
  /** The sliders this stage was permitted to move. */
  allowedVars: string[];
  /** Sliders that actually moved this pass, largest change first. */
  changed: { name: string; from: number; to: number; delta: number }[];
  /** The measurements this stage answered to, worst weighted residual first. */
  residuals: { key: string; target: number; got: number; weightedError: number }[];
  /** Realism-penalty contribution to the loss at the end of this pass (0 = nothing railed). */
  penalty: number;
}

/**
 * A lateral-view target for the nose-forward reshape: render the head at `renderYaw`, measure its
 * nose projection, and drive it toward `noseProjection` read off the photo at that side. This is the
 * only channel that can move the (front-invisible, orthographic-depth) nose-forward sculpt.
 */
export interface ProfileTarget {
  renderYaw: number;
  noseProjection: number;
}

export interface FitOptions {
  meta: RenderTargetMeta;
  initial: Record<string, number>;
  targets: FitTargets;
  /** The race/sex/head baseline measurements (from baselinesForTarget), for deviation-space fitting. */
  baseline?: Measurements;
  /** The sliders the optimiser may move. Defaults to the 35-key set; pass the install's full EFM set. */
  sliders?: readonly string[];
  /** Lateral nose-projection targets (from the left/right photos) that drive the nose-forward reshape. */
  profileTargets?: readonly ProfileTarget[];
  iterations?: number;
  onProgress?: (progress: FitProgress) => void;
  signal?: AbortSignal;
}

export interface FitResult {
  sliders: Record<string, number>;
  loss: number;
  iterations: number;
}

/**
 * Every EFM slider the install actually exposes for a sex, read from the facegenmorphs slider inis
 * (Expressive Facegen Morphs ships ~83). Using all of them, rather than a fixed 35, gives the fit far
 * more degrees of freedom — the optimiser measures which ones move the face and ignores the rest.
 */
export function efmSliderNames(
  sliderSets: readonly { sex: string; sliders: readonly { name: string }[] }[],
  sex: string
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const set of sliderSets) {
    if (set.sex.toLowerCase() !== sex.toLowerCase()) continue;
    for (const slider of set.sliders) {
      if (!slider.name.toUpperCase().startsWith("EFM_")) continue;
      if (seen.has(slider.name)) continue;
      seen.add(slider.name);
      names.push(slider.name);
    }
  }
  return names;
}

export function measurementsOf(analysis: FaceAnalysis): Measurements {
  const out: Measurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const value = analysis.measurements[key]?.value;
    if (Number.isFinite(value)) out[key] = value as number;
  }
  return out;
}

/**
 * Fuses the measurements of every reference photo into one target, weighting each contribution by
 * the measurement's own trust so a low-confidence reading (a steep angle, an occluded feature)
 * pulls the target less than a clean frontal one. No view is discarded.
 */
export function buildTargetsFromViews(analyses: readonly FaceAnalysis[]): FitTargets {
  const values: Measurements = {};
  const weights: Measurements = {};
  for (const key of MEASUREMENT_KEYS) {
    let weighted = 0;
    let total = 0;
    for (const analysis of analyses) {
      const value = analysis.measurements[key]?.value;
      const trust = analysis.trust[key] ?? 0;
      if (!Number.isFinite(value) || trust <= 0) continue;
      weighted += (value as number) * trust;
      total += trust;
    }
    if (total > 0) {
      values[key] = weighted / total;
      weights[key] = Math.min(1, total / Math.max(1, analyses.length));
    }
  }
  return { values, weights };
}

/**
 * How much each measurement can be trusted when read off a bald, textureless render. Geometry the
 * mesh actually carries (face/jaw/nose/cheek/chin proportions, eye spacing, mouth width) is full
 * weight; features MediaPipe reads mostly from texture the render lacks (eyebrows, lip fullness,
 * iris, lid curvature) are damped so they neither dominate the loss nor cap the achievable score.
 */
const RENDER_RELIABILITY: Partial<Record<MeasurementKey, number>> = {
  irisSize: 0,
  eyeOpenness: 0.3,
  browHeight: 0.4,
  browThickness: 0.2,
  browAngle: 0.5,
  browWidth: 0.6,
  lipFullness: 0.4,
  lipGap: 0.2,
  upperLip: 0.6,
  lowerLip: 0.6,
  upperLidCurve: 0.3,
  lowerLidCurve: 0.3,
  eyeTilt: 0.6
};

/**
 * Extra loss weight on the proportions that define the overall silhouette and the chin-anchored lower
 * face -- the two things a real-photo fit most often leaves on the table.
 *
 * Measured on Gal Gadot's front photo through the app's own measureFace (the authority, not the rough
 * offline landmarks): the neutral Imperial-HPH head is far too round -- faceAspect 1.08 against a
 * target of 1.23 -- and its jaw is too wide (0.84 vs 0.78). Those are the biggest residuals in the
 * whole fit, and the face reads "round, not elongated" until they are paid down; faceAspect is raised
 * mostly by narrowing the jaw/cheeks rather than dropping the chin (which would fight the lower-face
 * targets). `lowerFace` (nose-base to chin) is the one vertical measured up from the hard chin anchor
 * rather than down from the soft forehead top, so it is the trustworthy lever for lower-face height.
 */
const PROPORTION_EMPHASIS: Partial<Record<MeasurementKey, number>> = {
  faceAspect: 1.6,
  jawWidth: 1.4,
  lowerFace: 1.6,
  jawHeight: 1.4,
  mouthVertical: 1.3,
  chinShape: 1.2
};

/**
 * Rebuilds the targets the loss actually uses: (a) folds each photo value into render space as a
 * deviation from neutral -- target = renderNeutral + (photo - raceBaseline) -- so any constant bias
 * between how MediaPipe reads a render vs a photo cancels; and (b) scales each weight by the render
 * reliability of that measurement.
 */
function effectiveTargets(
  targets: FitTargets,
  baseline: Measurements | undefined,
  renderNeutral: Measurements
): FitTargets {
  const values: Measurements = {};
  const weights: Measurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const photo = targets.values[key];
    if (!Number.isFinite(photo)) continue;
    const weight =
      (targets.weights[key] ?? 0) * (RENDER_RELIABILITY[key] ?? 1) * (PROPORTION_EMPHASIS[key] ?? 1);
    if (weight <= 0.01) continue;
    const b = baseline?.[key];
    const n = renderNeutral[key];
    values[key] =
      Number.isFinite(b) && Number.isFinite(n)
        ? (n as number) + ((photo as number) - (b as number))
        : (photo as number);
    weights[key] = weight;
  }
  return { values, weights };
}

const activeKeys = (targets: FitTargets): MeasurementKey[] =>
  MEASUREMENT_KEYS.filter(
    (key) => Number.isFinite(targets.values[key]) && (targets.weights[key] ?? 0) > 0.01
  );

const scaleOf = (value: number) => Math.max(Math.abs(value), 0.02);

const lossOf = (
  targets: FitTargets,
  keys: MeasurementKey[],
  render: Measurements,
  sliders?: Record<string, number>
): number => {
  let sum = 0;
  for (const key of keys) {
    const target = targets.values[key] as number;
    const got = render[key];
    if (!Number.isFinite(got)) continue;
    const weight = targets.weights[key] ?? 0;
    const relative = (target - (got as number)) / scaleOf(target);
    sum += weight * relative * relative;
  }
  // Realism prior: penalise railed/deformed slider sets so the depth-blind front loss can't reward them.
  if (sliders) sum += realismPenalty(sliders);
  return sum;
};

const clampEfm = (value: number) => Math.max(-EFM_LIMIT, Math.min(EFM_LIMIT, value));

/** Builds the numeric debug trace for one pass: what it moved and what it was chasing. */
function buildPassTrace(
  before: Record<string, number>,
  after: Record<string, number>,
  allowedVars: string[],
  keys: MeasurementKey[],
  effective: FitTargets,
  render: Measurements
): FitPassTrace {
  const changed = allowedVars
    .map((name) => ({ name, from: before[name] ?? 0, to: after[name] ?? 0 }))
    .filter((c) => Math.abs(c.to - c.from) > 1e-4)
    .map((c) => ({ ...c, delta: c.to - c.from }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const residuals = keys
    .map((key) => {
      const target = effective.values[key] as number;
      const got = render[key];
      const weight = effective.weights[key] ?? 0;
      const rel = Number.isFinite(got) ? (target - (got as number)) / scaleOf(target) : 0;
      return { key: key as string, target, got: (got as number) ?? NaN, weightedError: weight * rel * rel };
    })
    .filter((r) => Number.isFinite(r.got))
    .sort((a, b) => b.weightedError - a.weightedError)
    .slice(0, 8);
  return { allowedVars: [...allowedVars], changed, residuals, penalty: realismPenalty(after) };
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Fit cancelled", "AbortError");
};

/** Renders one slider set frontally (reshape sentinels applied) and measures it. Null when no face. */
async function evaluate(
  meta: RenderTargetMeta,
  sliders: Record<string, number>
): Promise<Measurements | null> {
  const images = await renderHeads(meta, [reshapedRenderRequest("eval", sliders, { yaw: 0 })]);
  const dataUrl = images.get("eval");
  if (!dataUrl) return null;
  const analysis = await measureRenderDataUrl(dataUrl);
  return analysis ? measurementsOf(analysis) : null;
}

/**
 * A fit stage: the sliders it may move and the measurements it answers to. The optimiser fits the
 * OVERALL CONTOUR FIRST (face aspect / jaw & cheek width -- the elongated-vs-round silhouette, which
 * on a real photo is the single biggest residual), THEN works the detail regions bottom-up: lower
 * face (anchored on the hard chin, not the soft forehead top), then nose, then eyes/brows. Doing the
 * contour last starved it and left the face round; anchoring the details from the chin keeps the
 * "whole face is up" drift from accumulating downward. Each region is a small, well-conditioned solve
 * rather than one 83-variable solve in which the global face-height lever quietly absorbs residuals a
 * local lever should fix. Every accepted step must still lower the GLOBAL weighted loss, so staging
 * and ordering cannot regress the score.
 */
interface FitStage {
  label: string;
  /** Selects this stage's sliders from the install's full active EFM set. */
  pickVars: (available: readonly string[]) => string[];
  keys: MeasurementKey[];
  maxSteps: number;
}

const upper = (name: string) => name.toUpperCase();
const isOneOf = (name: string, names: string[]) => names.includes(upper(name));
const startsWithAny = (name: string, prefixes: string[]) =>
  prefixes.some((prefix) => upper(name).startsWith(prefix));

const FIT_STAGES: FitStage[] = [
  {
    // The overall silhouette first: elongate-vs-round is the biggest residual on a real photo, and it
    // is set mostly by narrowing the jaw/cheeks (raising face aspect) rather than dropping the chin.
    // Locking the contour before the detail regions is what stops the face coming out round.
    label: "Overall face shape",
    pickVars: (a) =>
      a.filter(
        (n) =>
          isOneOf(n, ["EFM_FACE_HEIGHT", "EFM_FACE_DEPTH", "EFM_JAW_WIDTH", "EFM_JAW_HEIGHT", "EFM_CHEEK_WIDTH", "EFM_CHEEK_HEIGHT"]) ||
          // The sculpt width/height reshape -- the levers that actually reach the elongation target.
          n === "__FaceWidthScale" ||
          n === "__FaceHeightScale" ||
          // The jaw-corner lift belongs with the contour, not the late detail pass: tightening the
          // jawline raises face-aspect (elongation). Doing it late "crushed" the already-shaped face.
          n === "__JawHeight"
      ),
    keys: ["faceAspect", "cheekWidth", "cheekHeight", "jawWidth", "jawHeight"],
    maxSteps: 6
  },
  {
    // Then the lower face, anchored on the chin: set the jaw line and mouth height within the contour
    // so the "whole face is up" drift cannot accumulate downward.
    label: "Mouth, chin & jaw - attention to mouth x jaw alignment",
    // Jaw levers are handled in the contour stage above (not here), so a late jaw move cannot crush the
    // face the contour already shaped.
    pickVars: (a) =>
      a.filter((n) => startsWithAny(n, ["EFM_LIP", "EFM_CHIN", "EFM_PHILTRUM", "EFM_TUBERCLE", "EFM_Oral"])),
    keys: [
      "mouthVertical", "mouthWidth", "mouthAngle", "lowerFace", "philtrumWidth",
      "upperLip", "lowerLip", "lipFullness", "lipGap", "chinWidth", "chinShape", "jawHeight"
    ],
    maxSteps: 6
  },
  {
    label: "Nose",
    pickVars: (a) => a.filter((n) => startsWithAny(n, ["EFM_NOSE"])),
    keys: [
      "noseWidth", "noseBridgeWidth", "noseTipWidth",
      "noseLength", "noseVertical", "noseRootHeight", "noseWingHeight"
    ],
    maxSteps: 6
  },
  {
    label: "Eyes & brows",
    pickVars: (a) => a.filter((n) => startsWithAny(n, ["EFM_EYES", "EFM_BROW"])),
    keys: [
      "eyeVertical", "eyeWidth", "eyeSpacing", "eyeOpenness", "eyeInnerHeight", "eyeOuterHeight",
      "eyeInnerCorner", "eyeOuterCorner", "upperLidCurve", "lowerLidCurve", "eyeTilt",
      "browHeight", "browAngle", "browWidth", "browThickness"
    ],
    maxSteps: 3
  },
  {
    // Everything at once at the end, to settle any coupling the ordered blocks left between regions.
    label: "Overall polish",
    pickVars: (a) => [...a],
    keys: [...MEASUREMENT_KEYS],
    maxSteps: 0 // filled from options.iterations
  }
];

interface BlockContext {
  meta: RenderTargetMeta;
  effective: FitTargets;
  /** Every active measurement -- the loss/score the accept test protects. */
  globalKeys: MeasurementKey[];
  rowWeightOf: (key: MeasurementKey) => number;
  signal?: AbortSignal;
}

/**
 * Block-coordinate Levenberg-Marquardt over one stage's sliders (`vars`) against one stage's
 * measurements (`keys`). Mutates `sliders` in place; a step is accepted only when it lowers the
 * GLOBAL loss, which keeps the whole fit monotone. Returns the render and loss it settled at.
 */
async function optimizeBlock(
  ctx: BlockContext,
  sliders: Record<string, number>,
  base: Measurements,
  bestLoss: number,
  vars: string[],
  keys: MeasurementKey[],
  maxSteps: number
): Promise<{ base: Measurements; bestLoss: number; improved: boolean }> {
  const { meta, effective, globalKeys, rowWeightOf, signal } = ctx;
  const rowWeight = keys.map(rowWeightOf);
  let improvedAny = false;
  let lambda = 1;

  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(signal);

    // Jacobian d(measurement)/d(slider) on the real head, one perturbed render per stage slider,
    // batched into a single native call. Columns are pre-multiplied by the row weight.
    const perturbImages = await renderHeads(
      meta,
      vars.map((name) =>
        reshapedRenderRequest(name, { ...sliders, [name]: clampEfm((sliders[name] ?? 0) + PERTURB) }, { yaw: 0 })
      )
    );
    const jac: number[][] = keys.map(() => new Array(vars.length).fill(0)); // keys x vars
    for (let j = 0; j < vars.length; j++) {
      throwIfAborted(signal);
      const dataUrl = perturbImages.get(vars[j]);
      if (!dataUrl) continue;
      const analysis = await measureRenderDataUrl(dataUrl);
      if (!analysis) continue;
      const perturbed = measurementsOf(analysis);
      const applied = clampEfm((sliders[vars[j]] ?? 0) + PERTURB) - (sliders[vars[j]] ?? 0);
      if (Math.abs(applied) < 1e-6) continue;
      for (let k = 0; k < keys.length; k++) {
        const b = base[keys[k]];
        const p = perturbed[keys[k]];
        if (!Number.isFinite(b) || !Number.isFinite(p)) continue;
        jac[k][j] = (((p as number) - (b as number)) / applied) * rowWeight[k];
      }
    }

    // Weighted normal equations A Δ = g for the residual between target and current render.
    const n = vars.length;
    const a: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let k = 0; k < keys.length; k++) {
      const target = effective.values[keys[k]] as number;
      const got = base[keys[k]];
      if (!Number.isFinite(got)) continue;
      const residual = (target - (got as number)) * rowWeight[k];
      const row = jac[k];
      for (let i = 0; i < n; i++) {
        g[i] += row[i] * residual;
        for (let j = 0; j < n; j++) a[i][j] += row[i] * row[j];
      }
    }
    const diag = a.map((row, i) => row[i]);

    // Escalate damping until a step lowers the GLOBAL measured loss (not just this block's), so a
    // block that improves its own region without helping the whole face is simply skipped.
    let stepped = false;
    for (let attempt = 0; attempt < 7; attempt++) {
      throwIfAborted(signal);
      const damped = a.map((row, i) => row.map((val, j) => (j === i ? val + lambda * (diag[i] + 1e-9) : val)));
      const delta = gaussianSolve(damped, g);
      const candidate: Record<string, number> = { ...sliders };
      for (let j = 0; j < n; j++) candidate[vars[j]] = clampEfm((sliders[vars[j]] ?? 0) + delta[j]);
      const measured = await evaluate(meta, candidate);
      if (measured) {
        const candidateLoss = lossOf(effective, globalKeys, measured, candidate);
        if (candidateLoss < bestLoss - 1e-6) {
          for (const name of vars) sliders[name] = candidate[name];
          base = measured;
          bestLoss = candidateLoss;
          lambda = Math.max(lambda * 0.5, 1e-3);
          stepped = true;
          improvedAny = true;
          break;
        }
      }
      lambda *= 3;
    }

    if (!stepped) break; // this block can no longer lower the global loss
  }

  return { base, bestLoss, improved: improvedAny };
}

/** Renders at a lateral yaw (reshape applied) and reads the render's nose projection from raw landmarks. */
async function renderNoseProjection(
  meta: RenderTargetMeta,
  sliders: Record<string, number>,
  renderYaw: number
): Promise<number | null> {
  const images = await renderHeads(meta, [reshapedRenderRequest("prof", sliders, { yaw: renderYaw })]);
  const url = images.get("prof");
  if (!url) return null;
  const raw = await rawLandmarksFromDataUrl(url);
  return raw ? noseProjection(raw.landmarks, raw.aspect) : null;
}

/**
 * Drives the __NoseForward reshape to match the photos' lateral nose projection. One variable with a
 * roughly linear response, so a few Gauss-Newton steps on the summed residual converge. Only the
 * nose-forward sentinel moves, and it is invisible to the front (orthographic) render, so this cannot
 * disturb the front fit. Mutates `sliders.__NoseForward` in place; returns whether it moved.
 */
async function optimizeNoseForward(
  meta: RenderTargetMeta,
  sliders: Record<string, number>,
  targets: readonly ProfileTarget[],
  signal?: AbortSignal
): Promise<boolean> {
  const residualsAt = async (
    value: number
  ): Promise<{ residuals: number[]; sse: number } | null> => {
    const probe = { ...sliders, __NoseForward: clampNoseAuto(value) };
    const residuals: number[] = [];
    let sse = 0;
    for (const target of targets) {
      const projection = await renderNoseProjection(meta, probe, target.renderYaw);
      if (projection == null) return null;
      // Weight the profile target DOWN. The lateral photos read a fuller nose projection than reads
      // right head-on (and the render at ±30 is measured shallower than the photo), so aiming at the
      // full measured projection over-drove the nose; aim at a fraction of it.
      const residual = target.noseProjection * NOSE_PROFILE_WEIGHT - projection;
      residuals.push(residual);
      sse += residual * residual;
    }
    return residuals.length > 0 ? { residuals, sse } : null;
  };

  let value = clampNoseAuto(sliders.__NoseForward ?? 0);
  let current = await residualsAt(value);
  if (!current) return false;

  const h = 0.5;
  let moved = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    throwIfAborted(signal);
    const forward = await residualsAt(clampNoseAuto(value + h));
    if (!forward) break;
    // Gauss-Newton on r(v) = target - projection(v): J_i = dr_i/dv, step v -= (J.r)/(J.J).
    let num = 0;
    let den = 0;
    for (let i = 0; i < current.residuals.length; i++) {
      const jacobian = (forward.residuals[i] - current.residuals[i]) / h;
      num += jacobian * current.residuals[i];
      den += jacobian * jacobian;
    }
    if (den < 1e-9) break;
    const next = clampNoseAuto(value - num / den);
    if (Math.abs(next - value) < 1e-3) break;
    const candidate = await residualsAt(next);
    if (candidate && candidate.sse < current.sse - 1e-9) {
      value = next;
      current = candidate;
      sliders.__NoseForward = value;
      moved = true;
    } else {
      break;
    }
  }
  return moved;
}

/**
 * Measures the objective fit loss of one slider set without moving anything -- the number behind the
 * "Analyze fit" button, so a manual tweak can be judged as better or worse. Same deviation-space loss
 * the optimiser minimises, so its scale matches the fit score shown after "Analyze & improve".
 */
export async function scoreSliders(options: {
  meta: RenderTargetMeta;
  initial: Record<string, number>;
  targets: FitTargets;
  baseline?: Measurements;
  signal?: AbortSignal;
}): Promise<number> {
  const { meta, targets, signal } = options;
  throwIfAborted(signal);
  const renderNeutral = await evaluate(meta, {});
  if (!renderNeutral) throw new Error("The renderer could not produce a measurable head. Confirm Skyrim is indexed.");
  const effective = effectiveTargets(targets, options.baseline, renderNeutral);
  const keys = activeKeys(effective);
  const base = await evaluate(meta, options.initial);
  if (!base) throw new Error("The renderer could not produce a measurable head. Confirm Skyrim is indexed.");
  return lossOf(effective, keys, base, options.initial);
}

export async function fitSliders(options: FitOptions): Promise<FitResult> {
  const { meta, targets, signal } = options;
  const polishSteps = Math.max(1, Math.min(6, options.iterations ?? 5));
  // The EFM morph set PLUS the sculpt reshape sentinels (face width/height, nose-forward). The
  // reshape is what lets the fit cross the morph ceilings for elongation and nose projection.
  const allVars = [
    ...(options.sliders && options.sliders.length > 0 ? options.sliders : EFM_FIT_SLIDERS),
    ...RESHAPE_KEYS
  ];
  const sliders: Record<string, number> = { ...options.initial };
  for (const name of allVars) sliders[name] = clampEfm(sliders[name] ?? 0);

  throwIfAborted(signal);
  // The neutral render is the deviation reference: it lets the loss compare shape changes, not the
  // absolute way MediaPipe happens to read a render vs a photo.
  const renderNeutral = await evaluate(meta, {});
  if (!renderNeutral) throw new Error("The renderer could not produce a measurable head. Confirm Skyrim is indexed.");
  const effective = effectiveTargets(targets, options.baseline, renderNeutral);
  const globalKeys = activeKeys(effective);
  // Per-measurement row weight (confidence + range), constant across the fit.
  const rowWeightMap = new Map<MeasurementKey, number>(
    globalKeys.map((key) => [key, Math.sqrt(effective.weights[key] ?? 0) / scaleOf(effective.values[key] as number)])
  );

  let base = await evaluate(meta, sliders);
  if (!base) throw new Error("The renderer could not produce a measurable head. Confirm Skyrim is indexed.");
  let bestLoss = lossOf(effective, globalKeys, base, sliders);

  const ctx: BlockContext = {
    meta,
    effective,
    globalKeys,
    rowWeightOf: (key) => rowWeightMap.get(key) ?? 0,
    signal
  };

  // Resolve each stage against the install's real slider set and the active measurements, dropping
  // any stage with no movable slider or no measurement to answer to.
  const stages = FIT_STAGES.map((stage) => ({
    label: stage.label,
    vars: stage.pickVars(allVars),
    keys: stage.keys.filter((key) => globalKeys.includes(key)),
    maxSteps: stage.label === "Overall polish" ? polishSteps : stage.maxSteps
  })).filter((stage) => stage.vars.length > 0 && stage.keys.length > 0 && stage.maxSteps > 0);

  const hasProfile = (options.profileTargets?.length ?? 0) > 0;
  const totalStages = stages.length + (hasProfile ? 1 : 0);

  for (let s = 0; s < stages.length; s++) {
    throwIfAborted(signal);
    const stage = stages[s];
    const before = DEBUG ? { ...sliders } : null;
    const result = await optimizeBlock(ctx, sliders, base, bestLoss, stage.vars, stage.keys, stage.maxSteps);
    base = result.base;
    bestLoss = result.bestLoss;
    options.onProgress?.({
      iteration: s + 1,
      totalIterations: totalStages,
      loss: bestLoss,
      improved: result.improved,
      sliders: { ...sliders },
      label: stage.label,
      ...(before ? { trace: buildPassTrace(before, sliders, stage.vars, stage.keys, effective, base) } : {})
    });
  }

  // Lateral nose projection is a depth feature the front render cannot see, so it gets its own pass
  // over the nose-forward reshape, using the profile photos as targets.
  if (hasProfile) {
    throwIfAborted(signal);
    const before = DEBUG ? { ...sliders } : null;
    const moved = await optimizeNoseForward(meta, sliders, options.profileTargets!, signal);
    options.onProgress?.({
      iteration: totalStages,
      totalIterations: totalStages,
      loss: bestLoss,
      improved: moved,
      sliders: { ...sliders },
      label: "Nose projection (profile)",
      ...(before ? { trace: buildPassTrace(before, sliders, ["__NoseForward"], [], effective, base) } : {})
    });
  }

  return { sliders, loss: bestLoss, iterations: totalStages };
}

function gaussianSolve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) continue;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => (Number.isFinite(row[n]) ? row[n] : 0));
}
