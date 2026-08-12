import type { MorphRegistrySnapshot } from "./nativeBridge";
import type { MeasurementKey } from "./faceAnalysis";

/**
 * RaceMenu slider families are separate mods with separate value ranges. Everything here is
 * measured from real hand-authored presets rather than assumed:
 *
 *   family  n     abs max   mean |v|
 *   EFM     148   3.00      0.79
 *   NSK      18   1.31      0.31
 *   SPG      36   1.31      0.40
 *   RANs      6   1.00      0.28
 *   CME      72   1.31*     0.47      (*excluding the integer type selectors below)
 *
 * So EFM runs to +/-3 and the rest run to about +/-1. A CME value written on the EFM scale would
 * be three times too strong.
 */
export type SliderFamily = "EFM" | "CME" | "NSK" | "SPG" | "RANs" | "ECE";

export const FAMILY_RANGE: Record<SliderFamily, number> = {
  EFM: 3,
  CME: 1,
  NSK: 1,
  SPG: 1,
  RANs: 1,
  ECE: 1
};

/**
 * Sliders that select a whole shape from a numbered set rather than scaling a morph. They carry
 * integer indices (observed: CME_NoseType 26, CME_EyesType 21, CME_LipType 24, ECE_EarShape 6).
 * FaceForge cannot know which numbered vanilla nose matches a photograph without rendering them,
 * so it never writes these -- but it must not treat them as continuous either.
 */
export const INDEX_SLIDERS = new Set([
  "CME_NoseType",
  "CME_EyesType",
  "CME_LipType",
  "CME_HairType",
  "ECE_EarShape"
]);

export const familyOf = (name: string): SliderFamily | null => {
  const prefix = name.split("_")[0];
  return prefix in FAMILY_RANGE ? (prefix as SliderFamily) : null;
};

/**
 * Which family wins when more than one offers a slider for the same measurement.
 *
 * This is not a style preference. The families are separate mods that register separate morph
 * targets, and RaceMenu sums every registered morph onto the head -- so writing one measurement
 * into several families does not describe the face more precisely, it applies the same
 * displacement two to four times.
 *
 * Verified on this install rather than assumed. `Expressive Facegen Morphs.esl\sliders\human.ini`
 * registers `EFM_Jaw_Width = 16, Slider, EFM_Jaw_Narrow, EFM_Jaw_Wide`, and the vanilla
 * `FemaleHeadChargen.tri` that RaceMenu's own `CME_JawWidth` drives carries `JawNarrow`/`JawWide`
 * and contains no `EFM_`-prefixed morph at all. Two disjoint targets, both applied.
 *
 * Shipped that way from 0.6.0 to 0.23.2 and it is what "over-exaggerated" looked like: a preset
 * exported with a slider inventory loaded put one measured brow height onto EFM_Brow_Height 2.30,
 * CME_BrowUpDown 0.99, SPG_ECEBrowInnerHeight 0.99 and SPG_ECEBrowOuterHeight 0.98 -- three of the
 * four at 98-99% of their travel, for a face whose measured brow sat 70% off a *guessed* baseline.
 *
 * EFM first: the widest range, the most granular set, and the one FaceForge can confirm from the
 * plugin index. The rest are kept only for measurements EFM has no slider for (eye tilt, lip
 * fullness) or for installs where EFM is absent or inert, in which case the highest-priority
 * family the install actually offers wins.
 */
export const FAMILY_PRIORITY: readonly SliderFamily[] = ["EFM", "CME", "SPG", "NSK", "RANs", "ECE"];

const familyRank = (name: string): number => {
  const family = familyOf(name);
  return family === null ? Number.MAX_SAFE_INTEGER : FAMILY_PRIORITY.indexOf(family);
};

/**
 * Collapses each measurement onto the single highest-priority family present, leaving that
 * family's own fan-out intact -- EFM_Nose_Width, EFM_Nose_Wing_Width and EFM_Nose_Wing_Thickness
 * are three different pieces of anatomy an author moves together, not three copies of one value.
 */
export function oneFamilyPerMeasurement(
  definitions: readonly SliderDefinition[]
): SliderDefinition[] {
  const winner = new Map<MeasurementKey, number>();
  for (const item of definitions) {
    const rank = familyRank(item.name);
    const current = winner.get(item.source);
    if (current === undefined || rank < current) winner.set(item.source, rank);
  }
  return definitions.filter((item) => familyRank(item.name) === winner.get(item.source));
}

export interface SliderDefinition {
  name: string;
  label: string;
  group: "face" | "eyes" | "nose" | "mouth";
  /** Measurement that drives it. */
  source: MeasurementKey;
  /**
   * How hard this slider responds to its measurement, as a relative weight; the global gain in
   * faceAnalysis converts it to slider units. The baseline the measurement is compared against is
   * not here -- it lives in measurementBaselines, because it is a property of the head being
   * targeted rather than of the slider.
   */
  sensitivity: number;
  /** Angle-style sliders divide the measured degrees instead of taking a ratio. */
  angleDivisor?: number;
}

/**
 * The full map of what FaceForge can measure and which slider it drives, per family.
 *
 * Depth and projection sliders (`_Depth`, `_BackForward`) are deliberately absent: a single
 * front photograph contains no depth information, and guessing it is what makes a face look
 * generic in a different way. They become available with a profile view.
 *
 * Tooth sliders are absent for the same reason -- a closed-mouth portrait shows no teeth.
 */
export const SLIDER_DEFINITIONS: SliderDefinition[] = [
  // ---- EFM: face and jaw -------------------------------------------------------------------
  { name: "EFM_Face_Height", label: "Face height", group: "face", source: "faceAspect", sensitivity: 30 },
  { name: "EFM_Cheek_Width", label: "Cheek width", group: "face", source: "cheekWidth", sensitivity: 36 },
  { name: "EFM_Cheek_Height", label: "Cheek height", group: "face", source: "cheekHeight", sensitivity: -24 },
  { name: "EFM_Cheek_Shape", label: "Cheek shape", group: "face", source: "cheekWidth", sensitivity: 26 },
  { name: "EFM_Jaw_Width", label: "Jaw width", group: "face", source: "jawWidth", sensitivity: 34 },
  { name: "EFM_Jaw_Height", label: "Jaw height", group: "face", source: "jawHeight", sensitivity: -24 },
  { name: "EFM_Jaw_Shape", label: "Jaw taper", group: "face", source: "chinShape", sensitivity: 24 },
  { name: "EFM_Chin_Width", label: "Chin width", group: "face", source: "chinWidth", sensitivity: 32 },
  { name: "EFM_Chin_Shape", label: "Chin taper", group: "face", source: "chinShape", sensitivity: 20 },
  { name: "EFM_Chin_Height", label: "Chin height", group: "face", source: "lowerFace", sensitivity: 26 },

  // ---- EFM: eyes and brows -----------------------------------------------------------------
  { name: "EFM_Eyes_Size", label: "Eye size", group: "eyes", source: "eyeWidth", sensitivity: 35 },
  { name: "EFM_Eyes_Width", label: "Eye spacing", group: "eyes", source: "eyeSpacing", sensitivity: 38 },
  { name: "EFM_Eyes_Height", label: "Eye height", group: "eyes", source: "eyeVertical", sensitivity: -22 },
  { name: "EFM_Eyes_Upper_Height", label: "Upper eye shape", group: "eyes", source: "eyeOpenness", sensitivity: 22 },
  { name: "EFM_Eyes_Lower_Height", label: "Lower eye shape", group: "eyes", source: "eyeOpenness", sensitivity: 18 },
  { name: "EFM_Eyes_Inner_Height", label: "Inner eye height", group: "eyes", source: "eyeInnerHeight", sensitivity: 20 },
  { name: "EFM_Eyes_Outer_Height", label: "Outer eye height", group: "eyes", source: "eyeOuterHeight", sensitivity: 20 },
  { name: "EFM_Eyes_Inner_Width", label: "Inner eye width", group: "eyes", source: "eyeInnerCorner", sensitivity: 22 },
  { name: "EFM_Eyes_Outer_Width", label: "Outer eye width", group: "eyes", source: "eyeOuterCorner", sensitivity: 22 },
  { name: "EFM_Eyes_Inner_Thickness", label: "Inner lid thickness", group: "eyes", source: "eyeInnerHeight", sensitivity: 16 },
  { name: "EFM_Eyes_Outer_Thickness", label: "Outer lid thickness", group: "eyes", source: "eyeOuterHeight", sensitivity: 16 },
  { name: "EFM_Eyes_Upper_Shape", label: "Upper lid curve", group: "eyes", source: "upperLidCurve", sensitivity: 20 },
  { name: "EFM_Eyes_Lower_Shape", label: "Lower lid curve", group: "eyes", source: "lowerLidCurve", sensitivity: 20 },
  { name: "EFM_Eyelid_Upper", label: "Upper eyelid", group: "eyes", source: "upperLidCurve", sensitivity: 18 },
  { name: "EFM_Eyelid_Lower", label: "Lower eyelid", group: "eyes", source: "lowerLidCurve", sensitivity: 18 },
  { name: "EFM_Eyeball_Size", label: "Eyeball size", group: "eyes", source: "irisSize", sensitivity: 26 },
  { name: "EFM_Eyeball_Width", label: "Eyeball width", group: "eyes", source: "irisSize", sensitivity: 20 },
  { name: "EFM_Eyeball_Height", label: "Eyeball height", group: "eyes", source: "eyeOpenness", sensitivity: 16 },
  { name: "EFM_Iris_Width", label: "Iris width", group: "eyes", source: "irisSize", sensitivity: 28 },
  { name: "EFM_Eyeground_Height", label: "Eye socket height", group: "eyes", source: "eyeOpenness", sensitivity: 14 },
  { name: "EFM_Eyeground_Width", label: "Eye socket width", group: "eyes", source: "eyeWidth", sensitivity: 18 },
  { name: "EFM_Brow_Height", label: "Brow height", group: "eyes", source: "browHeight", sensitivity: 24 },
  { name: "EFM_Brow_Angle", label: "Brow angle", group: "eyes", source: "browAngle", sensitivity: 0, angleDivisor: 8 },
  { name: "EFM_Brow_Width", label: "Brow width", group: "eyes", source: "browWidth", sensitivity: 24 },
  { name: "EFM_Brow_Thickness", label: "Brow thickness", group: "eyes", source: "browThickness", sensitivity: 22 },

  // ---- EFM: nose ---------------------------------------------------------------------------
  { name: "EFM_Nose_Width", label: "Nose width", group: "nose", source: "noseWidth", sensitivity: 34 },
  { name: "EFM_Nose_Wing_Width", label: "Nose wing width", group: "nose", source: "noseWidth", sensitivity: 28 },
  { name: "EFM_Nose_Wing_Thickness", label: "Nose wing thickness", group: "nose", source: "noseWidth", sensitivity: 20 },
  { name: "EFM_Nose_Bridge_Width", label: "Nose bridge width", group: "nose", source: "noseBridgeWidth", sensitivity: 24 },
  { name: "EFM_Nose_Root_Width", label: "Nose root width", group: "nose", source: "noseBridgeWidth", sensitivity: 22 },
  { name: "EFM_Nose_Tip_Width", label: "Nose tip width", group: "nose", source: "noseTipWidth", sensitivity: 24 },
  { name: "EFM_Nose_Tip_Thickness", label: "Nose tip thickness", group: "nose", source: "noseTipWidth", sensitivity: 18 },
  { name: "EFM_Nose_Tip_Height", label: "Nose tip height", group: "nose", source: "noseVertical", sensitivity: -18 },
  { name: "EFM_Nose_Size", label: "Nose size", group: "nose", source: "noseLength", sensitivity: 26 },
  { name: "EFM_Nose_Height", label: "Nose height", group: "nose", source: "noseVertical", sensitivity: -22 },
  { name: "EFM_Nose_Root_Height", label: "Nose root height", group: "nose", source: "noseRootHeight", sensitivity: -20 },
  { name: "EFM_Nose_Wing_Height", label: "Nose wing height", group: "nose", source: "noseWingHeight", sensitivity: -20 },

  // ---- EFM: mouth --------------------------------------------------------------------------
  { name: "EFM_Lip_Width", label: "Mouth width", group: "mouth", source: "mouthWidth", sensitivity: 34 },
  { name: "EFM_Lip_Upper_Width", label: "Upper lip width", group: "mouth", source: "mouthWidth", sensitivity: 28 },
  { name: "EFM_Lip_Lower_Width", label: "Lower lip width", group: "mouth", source: "mouthWidth", sensitivity: 28 },
  { name: "EFM_Lip_Upper_Thickness", label: "Upper lip thickness", group: "mouth", source: "upperLip", sensitivity: 20 },
  { name: "EFM_Lip_Lower_Thickness", label: "Lower lip thickness", group: "mouth", source: "lowerLip", sensitivity: 20 },
  { name: "EFM_Lip_Height", label: "Mouth height", group: "mouth", source: "mouthVertical", sensitivity: -20 },
  { name: "EFM_Lip_Angle", label: "Mouth corner angle", group: "mouth", source: "mouthAngle", sensitivity: 0, angleDivisor: 6 },
  { name: "EFM_Philtrum_Width", label: "Philtrum width", group: "mouth", source: "philtrumWidth", sensitivity: 20 },
  { name: "EFM_Oral_Width", label: "Mouth opening width", group: "mouth", source: "mouthWidth", sensitivity: 22 },
  { name: "EFM_Oral_Height", label: "Mouth opening height", group: "mouth", source: "lipGap", sensitivity: 16 },
  { name: "EFM_Tubercle_Upper_Width", label: "Cupid's bow width", group: "mouth", source: "philtrumWidth", sensitivity: 18 },
  { name: "EFM_Tubercle_Upper_Height", label: "Cupid's bow height", group: "mouth", source: "upperLip", sensitivity: 16 },
  { name: "EFM_Tubercle_Upper_Thickness", label: "Upper tubercle", group: "mouth", source: "upperLip", sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Height", label: "Lower tubercle height", group: "mouth", source: "lowerLip", sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Width", label: "Lower tubercle width", group: "mouth", source: "mouthWidth", sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Thickness", label: "Lower tubercle", group: "mouth", source: "lowerLip", sensitivity: 16 },

  // ---- CME / NSK / SPG / RANs ---------------------------------------------------------------
  // Only sliders whose meaning is unambiguous from the name and which map to a measurement
  // FaceForge already takes. Every one of these is used by at least two of the five reference
  // preset authors, so they are sliders people actually reach for.
  { name: "CME_CheeksWidth", label: "Cheeks width", group: "face", source: "cheekWidth", sensitivity: 30 },
  { name: "CME_CheeksUpDown", label: "Cheeks up/down", group: "face", source: "cheekHeight", sensitivity: -22 },
  { name: "CME_JawWidth", label: "Jaw width", group: "face", source: "jawWidth", sensitivity: 30 },
  { name: "CME_JawUpDown", label: "Jaw up/down", group: "face", source: "jawHeight", sensitivity: -22 },
  { name: "CME_ChinWidth", label: "Chin width", group: "face", source: "chinWidth", sensitivity: 28 },
  { name: "CME_ChinUpDown", label: "Chin up/down", group: "face", source: "lowerFace", sensitivity: 22 },
  { name: "CME_EyesSize", label: "Eyes size", group: "eyes", source: "eyeWidth", sensitivity: 30 },
  { name: "CME_EyesInOut", label: "Eyes in/out", group: "eyes", source: "eyeSpacing", sensitivity: 32 },
  { name: "CME_EyesUpDown", label: "Eyes up/down", group: "eyes", source: "eyeVertical", sensitivity: -20 },
  { name: "CME_UpperEyesHeight", label: "Upper eye height", group: "eyes", source: "upperLidCurve", sensitivity: 18 },
  { name: "CME_LowerEyesHeight", label: "Lower eye height", group: "eyes", source: "lowerLidCurve", sensitivity: 18 },
  { name: "CME_BrowUpDown", label: "Brow up/down", group: "eyes", source: "browHeight", sensitivity: 22 },
  { name: "CME_BrowInOut", label: "Brow in/out", group: "eyes", source: "browWidth", sensitivity: 22 },
  { name: "CME_BrowSlope", label: "Brow slope", group: "eyes", source: "browAngle", sensitivity: 0, angleDivisor: 10 },
  { name: "CME_NoseLength", label: "Nose length", group: "nose", source: "noseLength", sensitivity: 26 },
  { name: "CME_NoseUpDown", label: "Nose up/down", group: "nose", source: "noseVertical", sensitivity: -20 },
  { name: "CME_NoseSellionWidth", label: "Nose bridge width", group: "nose", source: "noseBridgeWidth", sensitivity: 22 },
  { name: "CME_MouthWidth", label: "Mouth width", group: "mouth", source: "mouthWidth", sensitivity: 30 },
  { name: "CME_MouthUpDown", label: "Mouth up/down", group: "mouth", source: "mouthVertical", sensitivity: -18 },
  { name: "CME_UpperLipHeight", label: "Upper lip height", group: "mouth", source: "upperLip", sensitivity: 18 },
  { name: "CME_LowerLipHeight", label: "Lower lip height", group: "mouth", source: "lowerLip", sensitivity: 18 },
  { name: "NSK_EyeSize", label: "Eye size", group: "eyes", source: "eyeWidth", sensitivity: 30 },
  { name: "NSK_EyeAngle", label: "Eye angle", group: "eyes", source: "eyeTilt", sensitivity: 0, angleDivisor: 10 },
  { name: "NSK_EyelidOpen", label: "Eyelid open", group: "eyes", source: "eyeOpenness", sensitivity: 20 },
  { name: "NSK_BrowAngle", label: "Brow angle", group: "eyes", source: "browAngle", sensitivity: 0, angleDivisor: 10 },
  { name: "NSK_NoseWidth", label: "Nose width", group: "nose", source: "noseWidth", sensitivity: 30 },
  { name: "NSK_NoseSellionWidth", label: "Nose sellion width", group: "nose", source: "noseBridgeWidth", sensitivity: 22 },
  { name: "NSK_MouthWidth", label: "Mouth width", group: "mouth", source: "mouthWidth", sensitivity: 30 },
  { name: "NSK_LipThickness", label: "Lip thickness", group: "mouth", source: "lipFullness", sensitivity: 20 },
  { name: "SPG_ECEFaceWidth", label: "Face width", group: "face", source: "faceAspect", sensitivity: -26 },
  { name: "SPG_ECEFaceLength", label: "Face length", group: "face", source: "faceAspect", sensitivity: 26 },
  { name: "SPG_ECEBrowInnerHeight", label: "Brow inner height", group: "eyes", source: "browHeight", sensitivity: 20 },
  { name: "SPG_ECEBrowOuterHeight", label: "Brow outer height", group: "eyes", source: "browHeight", sensitivity: 18 },
  { name: "SPG_ECEBrowInnerWidth", label: "Brow inner width", group: "eyes", source: "browWidth", sensitivity: 20 },
  { name: "SPG_ECEBrowOuterWidth", label: "Brow outer width", group: "eyes", source: "browWidth", sensitivity: 20 },
  { name: "SPG_ECEBrowThickness", label: "Brow thickness", group: "eyes", source: "browThickness", sensitivity: 20 },
  { name: "SPG_ECEEyeInnerCornerHeight", label: "Inner corner height", group: "eyes", source: "eyeInnerHeight", sensitivity: 18 },
  { name: "SPG_ECEEyeOuterCornerHeight", label: "Outer corner height", group: "eyes", source: "eyeOuterHeight", sensitivity: 18 },
  { name: "SPG_ECEEyeInnerCornerWidth", label: "Inner corner width", group: "eyes", source: "eyeInnerCorner", sensitivity: 20 },
  { name: "SPG_ECEEyeOuterCornerWidth", label: "Outer corner width", group: "eyes", source: "eyeOuterCorner", sensitivity: 20 },
  { name: "SPG_ECEUpperEyeLidShape", label: "Upper lid shape", group: "eyes", source: "upperLidCurve", sensitivity: 18 },
  { name: "SPG_ECELowerEyeLidShape", label: "Lower lid shape", group: "eyes", source: "lowerLidCurve", sensitivity: 18 },
  { name: "SPG_ECENoseTipSize", label: "Nose tip size", group: "nose", source: "noseTipWidth", sensitivity: 22 },
  { name: "SPG_ECENoseWingHeight", label: "Nose wing height", group: "nose", source: "noseWingHeight", sensitivity: -18 },
  { name: "SPG_ECEMouthUpperLipShape", label: "Upper lip shape", group: "mouth", source: "upperLip", sensitivity: 18 },
  { name: "SPG_ECEMouthLowerLipShape", label: "Lower lip shape", group: "mouth", source: "lowerLip", sensitivity: 18 }
];

/**
 * The sliders a RaceMenu install actually offers, learned by reading a preset saved from that
 * install. FaceForge cannot enumerate slider mods from disk -- the names live inside RaceMenu at
 * runtime -- but any preset saved with sliders touched lists every one of them.
 */
export interface SliderInventory {
  names: Set<string>;
  fileName: string;
  familyCounts: Record<string, number>;
}

export function readSliderInventory(
  document: Record<string, unknown>,
  fileName: string
): SliderInventory {
  const morphs = document.morphs as { custom?: unknown } | undefined;
  const custom = Array.isArray(morphs?.custom) ? morphs.custom : [];
  const names = new Set<string>();
  const familyCounts: Record<string, number> = {};
  for (const entry of custom) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || name.length === 0) continue;
    names.add(name);
    const prefix = name.split("_")[0];
    familyCounts[prefix] = (familyCounts[prefix] ?? 0) + 1;
  }
  if (names.size === 0) {
    throw new Error(
      `${fileName} contains no sliders. Save a preset in RaceMenu after touching the sliders you want FaceForge to use.`
    );
  }
  return { names, fileName, familyCounts };
}

/**
 * Which sliders the installation can actually move on one specific head, resolved from the
 * facegenmorphs registry FaceForge.Core reads off disk.
 *
 * `inert` is the set that matters. A slider lands there when the install genuinely defines it --
 * some races.ini registers it, so RaceMenu shows it and a saved preset lists it -- but no mesh the
 * character wears carries its morph pair at a matching vertex count. Writing to such a slider is a
 * no-op the game reports no error for.
 */
export interface MorphAvailability {
  live: Set<string>;
  inert: Set<string>;
  headPath: string;
  headVertexCount: number;
  highPoly: boolean;
}

export function resolveMorphAvailability(
  registry: MorphRegistrySnapshot | null | undefined,
  target: { sex: string | null; highPolyHead: boolean; raceEditorId: string | null }
): MorphAvailability | null {
  if (!registry || registry.heads.length === 0) return null;
  const sex = (target.sex ?? "female").toLowerCase();
  const head =
    registry.heads.find(
      (item) => item.targetSex === sex && item.highPoly === target.highPolyHead
    ) ?? null;
  if (!head || head.error) return null;

  // 0.23.0 shipped without this guard and it cost roughly 42 working sliders on a High Poly Head
  // install: HPH registers its whole KL-topology morph set from a morphs.ini packed inside
  // High Poly Head.bsa, the loose-file read never saw it, and every EFM slider looked dead. A
  // registry that cannot see every morph source is only allowed to say "live", never "dead".
  if (registry.complete === false) return null;

  const morphs = new Set(head.morphNames.map((name) => name.toLowerCase()));
  const race = target.raceEditorId;
  const live = new Set<string>();
  const inert = new Set<string>();
  for (const set of registry.sliderSets) {
    if (set.sex !== sex) continue;
    // No race chosen yet means "any race that offers it", which is the permissive reading: a
    // slider is only called inert when it is registered somewhere and still has no geometry.
    if (race && !set.races.some((item) => item.toLowerCase() === race.toLowerCase())) continue;
    for (const slider of set.sliders) {
      const usable =
        morphs.has(slider.negativeMorph.toLowerCase()) &&
        morphs.has(slider.positiveMorph.toLowerCase());
      if (usable) live.add(slider.name);
      else inert.add(slider.name);
    }
  }
  // A slider offered by two plugins is live if either copy has geometry.
  for (const name of live) inert.delete(name);
  return {
    live,
    inert,
    headPath: head.chargenTriPath,
    headVertexCount: head.vertexCount,
    highPoly: head.highPoly
  };
}

/**
 * Which definitions to write. Without an inventory FaceForge falls back to EFM only, because
 * Expressive Facegen Morphs is the one family it can confirm from the plugin index; writing a
 * CME slider that the install does not define would put a dead key in the preset.
 *
 * Availability then removes what is provably inert. It only ever subtracts: a slider the registry
 * has never heard of keeps whatever the inventory decided, because the registry reads loose files
 * and a slider ini shipped inside a BSA is invisible to it. Absence of evidence is not treated as
 * evidence of absence -- the reverse would silently drop working sliders.
 *
 * The duplicate collapse runs last, after both filters, so the family that survives is one the
 * install genuinely offers and the head can genuinely move.
 */
export function selectDefinitions(
  inventory: SliderInventory | null,
  availability: MorphAvailability | null = null
): SliderDefinition[] {
  return oneFamilyPerMeasurement(offeredDefinitions(inventory, availability));
}

/** Everything the install offers and the head can move, before duplicates are collapsed. */
function offeredDefinitions(
  inventory: SliderInventory | null,
  availability: MorphAvailability | null
): SliderDefinition[] {
  const selected = inventory
    ? SLIDER_DEFINITIONS.filter(
        (item) => inventory.names.has(item.name) && !INDEX_SLIDERS.has(item.name)
      )
    : SLIDER_DEFINITIONS.filter((item) => familyOf(item.name) === "EFM");
  if (!availability) return selected;
  return selected.filter((item) => !availability.inert.has(item.name));
}

/**
 * Sliders this install offers that FaceForge deliberately leaves alone because another family
 * already carries the same measurement. Separate from `inertDefinitions`: these ones work, and
 * writing them would over-apply the shape rather than do nothing. The UI needs the distinction --
 * a shrinking slider count is otherwise indistinguishable from the 0.23.0 defect.
 */
export function supersededDefinitions(
  inventory: SliderInventory | null,
  availability: MorphAvailability | null = null
): SliderDefinition[] {
  const offered = offeredDefinitions(inventory, availability);
  const written = new Set(oneFamilyPerMeasurement(offered).map((item) => item.name));
  return offered.filter((item) => !written.has(item.name));
}

/** The definitions this head cannot move, so the UI can say so instead of writing dead keys. */
export function inertDefinitions(
  inventory: SliderInventory | null,
  availability: MorphAvailability | null
): SliderDefinition[] {
  if (!availability) return [];
  const selected = inventory
    ? SLIDER_DEFINITIONS.filter(
        (item) => inventory.names.has(item.name) && !INDEX_SLIDERS.has(item.name)
      )
    : SLIDER_DEFINITIONS.filter((item) => familyOf(item.name) === "EFM");
  return selected.filter((item) => availability.inert.has(item.name));
}
