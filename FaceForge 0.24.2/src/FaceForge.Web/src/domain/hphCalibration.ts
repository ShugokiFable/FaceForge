import type { AppearanceChoice } from "./nativeBridge";
import type { TargetSex } from "./headPartPreferences";
import { isHighPolyHeadChoice } from "./headPartPreferences";

/** Local alias avoids a circular import with faceAnalysis (which consumes this module). */
type MeasurementKey = string;

/**
 * High Poly Head calibration from hand-authored HPH presets (MEMORY + YUYOU):
 *   Natalya, MAYA, Lulu, Dua Lipa Nyr, BellaRE, YUYOU PRESET 2
 *
 * Remined 2026-07-31 (morphs.custom + morphs.sculpt):
 *   - EFM mean |v| often 0.7–1.2, peaks ±3 (C-001)
 *   - Consensus axes (n≥3 HPH presets): Brow_Height −1.1, Chin_Width −0.93,
 *     Cheek_Height +0.85, Nose_Wing_Width −0.82, Chin_Height −0.67, Bridge noisy
 *   - Sculpt hosts (empty shells only — D-004, no dx/dy/dz):
 *       KL\High Poly Head\FemaleHeadCharGen.tri          3832  (5/6)
 *       KL\High Poly Head\FaceParts\FemaleHeadBrows…tri   371  (4/6)
 *       Actors\…\EyesFemaleChargen.tri                    176  (4/6)
 *   - MouthHumanFChargen appears on 2/6 only — not declared by default
 *   - Depth/tooth keys appear in author presets but never from a front photo
 */

/** Vanilla / unknown head response. */
export const STANDARD_RESPONSE_GAIN = 0.18;

/**
 * Withdrawn in 0.18.0. 0.16.0 raised the HPH gain to 0.24 and 0.17.0 to a slightly higher
 * effective response on the reasoning that "HPH needs more EFM travel for the same landmark
 * delta — denser mesh, authors sit higher in the ±3 band".
 *
 * Neither half of that holds up:
 *
 *  - **Vertex density does not change morph semantics.** An EFM slider's visible effect is
 *    defined by the TRI morph it drives, and High Poly Head ships its own EFM-compatible
 *    morphs. Nothing measured shows a given EFM value moving an HPH head less than a vanilla
 *    one; the claim was inferred from author *output*, not from the mesh.
 *
 *    (0.23.0 briefly "corrected" that sentence to say HPH has no EFM morphs, and gated ~42
 *    sliders out of every preset on the strength of it. It was wrong. HPH registers
 *    KL\femalehead_efm.tri -- along with cme, ece, rans, nuska, extra, expr and race -- from
 *    meshes\actors\character\facegenmorphs\high poly head.esm\morphs.ini, which is packed inside
 *    High Poly Head.bsa where a loose-file scan cannot see it. Verified by reading the archive
 *    directly, 2026-08-06. The original sentence stands.)
 *  - **Author values are not photo measurements.** Hand-authored presets sit high in the band
 *    because authors deliberately stylize. Matching their mean by raising gain makes FaceForge
 *    reproduce authorial exaggeration, which is a different goal from measuring a face.
 *
 * The gain stays at the value established in 0.7.0 against the hand-authored distribution until
 * someone measures the HPH CharGen mesh directly (roadmap item 1).
 */
export const HPH_RESPONSE_GAIN = STANDARD_RESPONSE_GAIN;

/**
 * Withdrawn in 0.18.0, and the reason matters for anything added here later.
 *
 * A baseline states what the *reference head* measures. A gain states how hard FaceForge pushes
 * a slider. 0.16.0/0.17.0 used baseline multipliers as a strength knob — the original comment
 * said so outright: "Factor < 1.0 lowers baseline → stronger slider for the same measurement".
 *
 * That breaks an invariant the whole pipeline rests on: a face whose measurements already equal
 * the target head must export zeros, because it has no deviation to encode. With these factors a
 * perfectly neutral face exported 27 non-zero sliders peaking at 0.55 on the HPH path alone, and
 * 34 peaking at 1.53 once race, sex and style stacked on top. Every real face carried that same
 * bias on top of its actual deviation, which is what "the estimates got worse" looked like.
 *
 * If the HPH head genuinely has different proportions than vanilla, that belongs here as
 * *measured* geometry — and then a neutral HPH face legitimately exports non-zero values,
 * because it really does differ from the vanilla reference. Until the mesh is measured there is
 * nothing to put in this table.
 */
export const HPH_BASELINE_FACTORS: Partial<Record<MeasurementKey, number>> = {};

/** Canonical CharGen TRI hosts used by finished HPH female packs. */
export const HPH_FEMALE_HEAD_SCULPT_HOST =
  "KL\\High Poly Head\\FemaleHeadCharGen.tri";
export const HPH_FEMALE_BROW_SCULPT_HOST =
  "KL\\High Poly Head\\FaceParts\\FemaleHeadBrowsCharGen.tri";
/** Vanilla eyes CharGen TRI — co-sculpted on 4/6 HPH MEMORY presets (not an HPH path). */
export const HPH_FEMALE_EYES_SCULPT_HOST =
  "Actors\\Character\\Character Assets\\EyesFemaleChargen.tri";
export const HPH_FEMALE_HEAD_VERTICES = 3832;
export const HPH_FEMALE_BROW_VERTICES = 371;
export const HPH_FEMALE_EYES_VERTICES = 176;

/**
 * Male HPH head host. No male HPH jslots in MEMORY yet — path mirrors the female
 * KL layout; eyes/brows male companions are omitted until evidenced.
 */
export const HPH_MALE_HEAD_SCULPT_HOST =
  "KL\\High Poly Head\\MaleHeadCharGen.tri";
export const HPH_MALE_HEAD_VERTICES = 3832;

export type HphSculptHostShell = {
  host: string;
  vertices: number;
  data: [];
};

export function responseGainForHead(highPolyHead: boolean): number {
  return highPolyHead ? HPH_RESPONSE_GAIN : STANDARD_RESPONSE_GAIN;
}

export function selectedFaceIsHighPolyHead(
  selections: readonly AppearanceChoice[]
): boolean {
  return selections.some(
    (choice) => choice.category === "face" && isHighPolyHeadChoice(choice)
  );
}

/**
 * Declares HPH sculpt *hosts* with empty vertex data so RaceMenu knows topology.
 * Does **not** invent dx/dy/dz (D-004). Authors finish likeness in Sculpt / F5-F9.
 */
export function hphSculptHostShell(sex: TargetSex): HphSculptHostShell[] {
  if (sex === "male") {
    return [{ host: HPH_MALE_HEAD_SCULPT_HOST, vertices: HPH_MALE_HEAD_VERTICES, data: [] }];
  }
  return [
    { host: HPH_FEMALE_HEAD_SCULPT_HOST, vertices: HPH_FEMALE_HEAD_VERTICES, data: [] },
    { host: HPH_FEMALE_BROW_SCULPT_HOST, vertices: HPH_FEMALE_BROW_VERTICES, data: [] },
    { host: HPH_FEMALE_EYES_SCULPT_HOST, vertices: HPH_FEMALE_EYES_VERTICES, data: [] }
  ];
}

/** Host paths FaceForge will declare for a sex (empty data). Useful for UI/notes. */
export function hphDeclaredHostPaths(sex: TargetSex): string[] {
  return hphSculptHostShell(sex).map((entry) => entry.host);
}

export function hphCalibrationNotes(highPolyHead: boolean): string[] {
  if (!highPolyHead) return [];
  return [
    "High Poly Head mesh selected. Slider values are measured the same way as for a vanilla head: the HPH-specific response and baseline factors added in 0.16.0 were withdrawn in 0.18.0 because they biased a neutral face instead of describing the mesh.",
    "Sculpt vertices are not synthesized (D-004). Empty host TRI entries declare HPH head + brows + eyes topology so RaceMenu targets the right mesh; finish likeness with the Sculpt tab or F5/F9 head export."
  ];
}
