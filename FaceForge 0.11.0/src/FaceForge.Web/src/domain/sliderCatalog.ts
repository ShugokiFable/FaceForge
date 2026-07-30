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

export interface SliderDefinition {
  name: string;
  label: string;
  group: "face" | "eyes" | "nose" | "mouth";
  /** Measurement that drives it. */
  source: MeasurementKey;
  /**
   * Baseline the measurement is compared against, and how hard it responds. Sensitivity is a
   * relative weight; the global gain in faceAnalysis converts it to slider units.
   */
  baseline: number;
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
  { name: "EFM_Face_Height", label: "Face height", group: "face", source: "faceAspect", baseline: 1.34, sensitivity: 30 },
  { name: "EFM_Cheek_Width", label: "Cheek width", group: "face", source: "cheekWidth", baseline: 0.91, sensitivity: 36 },
  { name: "EFM_Cheek_Height", label: "Cheek height", group: "face", source: "cheekHeight", baseline: 0.5, sensitivity: -24 },
  { name: "EFM_Cheek_Shape", label: "Cheek shape", group: "face", source: "cheekWidth", baseline: 0.91, sensitivity: 26 },
  { name: "EFM_Jaw_Width", label: "Jaw width", group: "face", source: "jawWidth", baseline: 0.79, sensitivity: 34 },
  { name: "EFM_Jaw_Height", label: "Jaw height", group: "face", source: "jawHeight", baseline: 0.75, sensitivity: -24 },
  { name: "EFM_Jaw_Shape", label: "Jaw taper", group: "face", source: "chinShape", baseline: 0.32, sensitivity: 24 },
  { name: "EFM_Chin_Width", label: "Chin width", group: "face", source: "chinWidth", baseline: 0.24, sensitivity: 32 },
  { name: "EFM_Chin_Shape", label: "Chin taper", group: "face", source: "chinShape", baseline: 0.32, sensitivity: 20 },
  { name: "EFM_Chin_Height", label: "Chin height", group: "face", source: "lowerFace", baseline: 0.33, sensitivity: 26 },

  // ---- EFM: eyes and brows -----------------------------------------------------------------
  { name: "EFM_Eyes_Size", label: "Eye size", group: "eyes", source: "eyeWidth", baseline: 0.18, sensitivity: 35 },
  { name: "EFM_Eyes_Width", label: "Eye spacing", group: "eyes", source: "eyeSpacing", baseline: 0.2, sensitivity: 38 },
  { name: "EFM_Eyes_Height", label: "Eye height", group: "eyes", source: "eyeVertical", baseline: 0.43, sensitivity: -22 },
  { name: "EFM_Eyes_Upper_Height", label: "Upper eye shape", group: "eyes", source: "eyeOpenness", baseline: 0.31, sensitivity: 22 },
  { name: "EFM_Eyes_Lower_Height", label: "Lower eye shape", group: "eyes", source: "eyeOpenness", baseline: 0.31, sensitivity: 18 },
  { name: "EFM_Eyes_Inner_Height", label: "Inner eye height", group: "eyes", source: "eyeInnerHeight", baseline: 0.22, sensitivity: 20 },
  { name: "EFM_Eyes_Outer_Height", label: "Outer eye height", group: "eyes", source: "eyeOuterHeight", baseline: 0.22, sensitivity: 20 },
  { name: "EFM_Eyes_Inner_Width", label: "Inner eye width", group: "eyes", source: "eyeInnerCorner", baseline: 0.055, sensitivity: 22 },
  { name: "EFM_Eyes_Outer_Width", label: "Outer eye width", group: "eyes", source: "eyeOuterCorner", baseline: 0.055, sensitivity: 22 },
  { name: "EFM_Eyes_Inner_Thickness", label: "Inner lid thickness", group: "eyes", source: "eyeInnerHeight", baseline: 0.22, sensitivity: 16 },
  { name: "EFM_Eyes_Outer_Thickness", label: "Outer lid thickness", group: "eyes", source: "eyeOuterHeight", baseline: 0.22, sensitivity: 16 },
  { name: "EFM_Eyes_Upper_Shape", label: "Upper lid curve", group: "eyes", source: "upperLidCurve", baseline: 0.28, sensitivity: 20 },
  { name: "EFM_Eyes_Lower_Shape", label: "Lower lid curve", group: "eyes", source: "lowerLidCurve", baseline: 0.22, sensitivity: 20 },
  { name: "EFM_Eyelid_Upper", label: "Upper eyelid", group: "eyes", source: "upperLidCurve", baseline: 0.28, sensitivity: 18 },
  { name: "EFM_Eyelid_Lower", label: "Lower eyelid", group: "eyes", source: "lowerLidCurve", baseline: 0.22, sensitivity: 18 },
  { name: "EFM_Eyeball_Size", label: "Eyeball size", group: "eyes", source: "irisSize", baseline: 0.115, sensitivity: 26 },
  { name: "EFM_Eyeball_Width", label: "Eyeball width", group: "eyes", source: "irisSize", baseline: 0.115, sensitivity: 20 },
  { name: "EFM_Eyeball_Height", label: "Eyeball height", group: "eyes", source: "eyeOpenness", baseline: 0.31, sensitivity: 16 },
  { name: "EFM_Iris_Width", label: "Iris width", group: "eyes", source: "irisSize", baseline: 0.115, sensitivity: 28 },
  { name: "EFM_Eyeground_Height", label: "Eye socket height", group: "eyes", source: "eyeOpenness", baseline: 0.31, sensitivity: 14 },
  { name: "EFM_Eyeground_Width", label: "Eye socket width", group: "eyes", source: "eyeWidth", baseline: 0.18, sensitivity: 18 },
  { name: "EFM_Brow_Height", label: "Brow height", group: "eyes", source: "browHeight", baseline: 0.075, sensitivity: 24 },
  { name: "EFM_Brow_Angle", label: "Brow angle", group: "eyes", source: "browAngle", baseline: 0, sensitivity: 0, angleDivisor: 8 },
  { name: "EFM_Brow_Width", label: "Brow width", group: "eyes", source: "browWidth", baseline: 0.18, sensitivity: 24 },
  { name: "EFM_Brow_Thickness", label: "Brow thickness", group: "eyes", source: "browThickness", baseline: 0.03, sensitivity: 22 },

  // ---- EFM: nose ---------------------------------------------------------------------------
  { name: "EFM_Nose_Width", label: "Nose width", group: "nose", source: "noseWidth", baseline: 0.25, sensitivity: 34 },
  { name: "EFM_Nose_Wing_Width", label: "Nose wing width", group: "nose", source: "noseWidth", baseline: 0.25, sensitivity: 28 },
  { name: "EFM_Nose_Wing_Thickness", label: "Nose wing thickness", group: "nose", source: "noseWidth", baseline: 0.25, sensitivity: 20 },
  { name: "EFM_Nose_Bridge_Width", label: "Nose bridge width", group: "nose", source: "noseBridgeWidth", baseline: 0.24, sensitivity: 24 },
  { name: "EFM_Nose_Root_Width", label: "Nose root width", group: "nose", source: "noseBridgeWidth", baseline: 0.24, sensitivity: 22 },
  { name: "EFM_Nose_Tip_Width", label: "Nose tip width", group: "nose", source: "noseTipWidth", baseline: 0.16, sensitivity: 24 },
  { name: "EFM_Nose_Tip_Thickness", label: "Nose tip thickness", group: "nose", source: "noseTipWidth", baseline: 0.16, sensitivity: 18 },
  { name: "EFM_Nose_Tip_Height", label: "Nose tip height", group: "nose", source: "noseVertical", baseline: 0.62, sensitivity: -18 },
  { name: "EFM_Nose_Size", label: "Nose size", group: "nose", source: "noseLength", baseline: 0.32, sensitivity: 26 },
  { name: "EFM_Nose_Height", label: "Nose height", group: "nose", source: "noseVertical", baseline: 0.62, sensitivity: -22 },
  { name: "EFM_Nose_Root_Height", label: "Nose root height", group: "nose", source: "noseRootHeight", baseline: 0.4, sensitivity: -20 },
  { name: "EFM_Nose_Wing_Height", label: "Nose wing height", group: "nose", source: "noseWingHeight", baseline: 0.62, sensitivity: -20 },

  // ---- EFM: mouth --------------------------------------------------------------------------
  { name: "EFM_Lip_Width", label: "Mouth width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 34 },
  { name: "EFM_Lip_Upper_Width", label: "Upper lip width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 28 },
  { name: "EFM_Lip_Lower_Width", label: "Lower lip width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 28 },
  { name: "EFM_Lip_Upper_Thickness", label: "Upper lip thickness", group: "mouth", source: "upperLip", baseline: 0.026, sensitivity: 20 },
  { name: "EFM_Lip_Lower_Thickness", label: "Lower lip thickness", group: "mouth", source: "lowerLip", baseline: 0.032, sensitivity: 20 },
  { name: "EFM_Lip_Height", label: "Mouth height", group: "mouth", source: "mouthVertical", baseline: 0.76, sensitivity: -20 },
  { name: "EFM_Lip_Angle", label: "Mouth corner angle", group: "mouth", source: "mouthAngle", baseline: 0, sensitivity: 0, angleDivisor: 6 },
  { name: "EFM_Philtrum_Width", label: "Philtrum width", group: "mouth", source: "philtrumWidth", baseline: 0.12, sensitivity: 20 },
  { name: "EFM_Oral_Width", label: "Mouth opening width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 22 },
  { name: "EFM_Oral_Height", label: "Mouth opening height", group: "mouth", source: "lipGap", baseline: 0.012, sensitivity: 16 },
  { name: "EFM_Tubercle_Upper_Width", label: "Cupid's bow width", group: "mouth", source: "philtrumWidth", baseline: 0.12, sensitivity: 18 },
  { name: "EFM_Tubercle_Upper_Height", label: "Cupid's bow height", group: "mouth", source: "upperLip", baseline: 0.026, sensitivity: 16 },
  { name: "EFM_Tubercle_Upper_Thickness", label: "Upper tubercle", group: "mouth", source: "upperLip", baseline: 0.026, sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Height", label: "Lower tubercle height", group: "mouth", source: "lowerLip", baseline: 0.032, sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Width", label: "Lower tubercle width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 16 },
  { name: "EFM_Tubercle_Lower_Thickness", label: "Lower tubercle", group: "mouth", source: "lowerLip", baseline: 0.032, sensitivity: 16 },

  // ---- CME / NSK / SPG / RANs ---------------------------------------------------------------
  // Only sliders whose meaning is unambiguous from the name and which map to a measurement
  // FaceForge already takes. Every one of these is used by at least two of the five reference
  // preset authors, so they are sliders people actually reach for.
  { name: "CME_CheeksWidth", label: "Cheeks width", group: "face", source: "cheekWidth", baseline: 0.91, sensitivity: 30 },
  { name: "CME_CheeksUpDown", label: "Cheeks up/down", group: "face", source: "cheekHeight", baseline: 0.5, sensitivity: -22 },
  { name: "CME_JawWidth", label: "Jaw width", group: "face", source: "jawWidth", baseline: 0.79, sensitivity: 30 },
  { name: "CME_JawUpDown", label: "Jaw up/down", group: "face", source: "jawHeight", baseline: 0.75, sensitivity: -22 },
  { name: "CME_ChinWidth", label: "Chin width", group: "face", source: "chinWidth", baseline: 0.24, sensitivity: 28 },
  { name: "CME_ChinUpDown", label: "Chin up/down", group: "face", source: "lowerFace", baseline: 0.33, sensitivity: 22 },
  { name: "CME_EyesSize", label: "Eyes size", group: "eyes", source: "eyeWidth", baseline: 0.18, sensitivity: 30 },
  { name: "CME_EyesInOut", label: "Eyes in/out", group: "eyes", source: "eyeSpacing", baseline: 0.2, sensitivity: 32 },
  { name: "CME_EyesUpDown", label: "Eyes up/down", group: "eyes", source: "eyeVertical", baseline: 0.43, sensitivity: -20 },
  { name: "CME_UpperEyesHeight", label: "Upper eye height", group: "eyes", source: "upperLidCurve", baseline: 0.28, sensitivity: 18 },
  { name: "CME_LowerEyesHeight", label: "Lower eye height", group: "eyes", source: "lowerLidCurve", baseline: 0.22, sensitivity: 18 },
  { name: "CME_BrowUpDown", label: "Brow up/down", group: "eyes", source: "browHeight", baseline: 0.075, sensitivity: 22 },
  { name: "CME_BrowInOut", label: "Brow in/out", group: "eyes", source: "browWidth", baseline: 0.18, sensitivity: 22 },
  { name: "CME_BrowSlope", label: "Brow slope", group: "eyes", source: "browAngle", baseline: 0, sensitivity: 0, angleDivisor: 10 },
  { name: "CME_NoseLength", label: "Nose length", group: "nose", source: "noseLength", baseline: 0.32, sensitivity: 26 },
  { name: "CME_NoseUpDown", label: "Nose up/down", group: "nose", source: "noseVertical", baseline: 0.62, sensitivity: -20 },
  { name: "CME_NoseSellionWidth", label: "Nose bridge width", group: "nose", source: "noseBridgeWidth", baseline: 0.24, sensitivity: 22 },
  { name: "CME_MouthWidth", label: "Mouth width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 30 },
  { name: "CME_MouthUpDown", label: "Mouth up/down", group: "mouth", source: "mouthVertical", baseline: 0.76, sensitivity: -18 },
  { name: "CME_UpperLipHeight", label: "Upper lip height", group: "mouth", source: "upperLip", baseline: 0.026, sensitivity: 18 },
  { name: "CME_LowerLipHeight", label: "Lower lip height", group: "mouth", source: "lowerLip", baseline: 0.032, sensitivity: 18 },
  { name: "NSK_EyeSize", label: "Eye size", group: "eyes", source: "eyeWidth", baseline: 0.18, sensitivity: 30 },
  { name: "NSK_EyeAngle", label: "Eye angle", group: "eyes", source: "eyeTilt", baseline: 0, sensitivity: 0, angleDivisor: 10 },
  { name: "NSK_EyelidOpen", label: "Eyelid open", group: "eyes", source: "eyeOpenness", baseline: 0.31, sensitivity: 20 },
  { name: "NSK_BrowAngle", label: "Brow angle", group: "eyes", source: "browAngle", baseline: 0, sensitivity: 0, angleDivisor: 10 },
  { name: "NSK_NoseWidth", label: "Nose width", group: "nose", source: "noseWidth", baseline: 0.25, sensitivity: 30 },
  { name: "NSK_NoseSellionWidth", label: "Nose sellion width", group: "nose", source: "noseBridgeWidth", baseline: 0.24, sensitivity: 22 },
  { name: "NSK_MouthWidth", label: "Mouth width", group: "mouth", source: "mouthWidth", baseline: 0.37, sensitivity: 30 },
  { name: "NSK_LipThickness", label: "Lip thickness", group: "mouth", source: "lipFullness", baseline: 0.058, sensitivity: 20 },
  { name: "SPG_ECEFaceWidth", label: "Face width", group: "face", source: "faceAspect", baseline: 1.34, sensitivity: -26 },
  { name: "SPG_ECEFaceLength", label: "Face length", group: "face", source: "faceAspect", baseline: 1.34, sensitivity: 26 },
  { name: "SPG_ECEBrowInnerHeight", label: "Brow inner height", group: "eyes", source: "browHeight", baseline: 0.075, sensitivity: 20 },
  { name: "SPG_ECEBrowOuterHeight", label: "Brow outer height", group: "eyes", source: "browHeight", baseline: 0.075, sensitivity: 18 },
  { name: "SPG_ECEBrowInnerWidth", label: "Brow inner width", group: "eyes", source: "browWidth", baseline: 0.18, sensitivity: 20 },
  { name: "SPG_ECEBrowOuterWidth", label: "Brow outer width", group: "eyes", source: "browWidth", baseline: 0.18, sensitivity: 20 },
  { name: "SPG_ECEBrowThickness", label: "Brow thickness", group: "eyes", source: "browThickness", baseline: 0.03, sensitivity: 20 },
  { name: "SPG_ECEEyeInnerCornerHeight", label: "Inner corner height", group: "eyes", source: "eyeInnerHeight", baseline: 0.22, sensitivity: 18 },
  { name: "SPG_ECEEyeOuterCornerHeight", label: "Outer corner height", group: "eyes", source: "eyeOuterHeight", baseline: 0.22, sensitivity: 18 },
  { name: "SPG_ECEEyeInnerCornerWidth", label: "Inner corner width", group: "eyes", source: "eyeInnerCorner", baseline: 0.055, sensitivity: 20 },
  { name: "SPG_ECEEyeOuterCornerWidth", label: "Outer corner width", group: "eyes", source: "eyeOuterCorner", baseline: 0.055, sensitivity: 20 },
  { name: "SPG_ECEUpperEyeLidShape", label: "Upper lid shape", group: "eyes", source: "upperLidCurve", baseline: 0.28, sensitivity: 18 },
  { name: "SPG_ECELowerEyeLidShape", label: "Lower lid shape", group: "eyes", source: "lowerLidCurve", baseline: 0.22, sensitivity: 18 },
  { name: "SPG_ECENoseTipSize", label: "Nose tip size", group: "nose", source: "noseTipWidth", baseline: 0.16, sensitivity: 22 },
  { name: "SPG_ECENoseWingHeight", label: "Nose wing height", group: "nose", source: "noseWingHeight", baseline: 0.62, sensitivity: -18 },
  { name: "SPG_ECEMouthUpperLipShape", label: "Upper lip shape", group: "mouth", source: "upperLip", baseline: 0.026, sensitivity: 18 },
  { name: "SPG_ECEMouthLowerLipShape", label: "Lower lip shape", group: "mouth", source: "lowerLip", baseline: 0.032, sensitivity: 18 }
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
 * Which definitions to write. Without an inventory FaceForge falls back to EFM only, because
 * Expressive Facegen Morphs is the one family it can confirm from the plugin index; writing a
 * CME slider that the install does not define would put a dead key in the preset.
 */
export function selectDefinitions(
  inventory: SliderInventory | null
): SliderDefinition[] {
  if (!inventory) {
    return SLIDER_DEFINITIONS.filter((item) => familyOf(item.name) === "EFM");
  }
  return SLIDER_DEFINITIONS.filter(
    (item) => inventory.names.has(item.name) && !INDEX_SLIDERS.has(item.name)
  );
}
