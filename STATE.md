# FaceForge state

- Active version: `FaceForge 0.24.1` (parent 0.24.0), tool-validated release.
- Final EXE: `FaceForge-0.24.1-STANDALONE.exe`, 125,974,779 bytes.
- SHA-256: `61D0399A7B6D86E64EB4707E93239A0EC385F78A61C003DB4D4AF58F85E9C7FD`.
- FileVersion 0.24.1.0; launch verified (still running after 12s, then stopped).
- Tests: 100 frontend (18 new since 0.23.2), 96 native assertions. TypeScript clean, .NET Release clean, 0 warnings.
- Product version: `0.24.1`; public distribution remains exactly one self-contained EXE.

## What changed

FaceForge stops applying the same measurement several times, and stops letting a guessed baseline
sculpt at full strength. Both defects predate 0.23.x; both were found from a preset the user
exported and loaded in game, which came out flat with enormous flat brows.

**One measurement, one family.** EFM, CME, NSK and SPG are separate mods registering separate morph
targets, and RaceMenu sums every registered morph onto the head. 31 of 39 measurements were being
written into 2-3 families at once, so the same displacement landed on the face two to four times.
Confirmed on this install: EFM's `human.ini` maps `EFM_Jaw_Width` to `EFM_Jaw_Narrow`/`EFM_Jaw_Wide`,
while the vanilla `FemaleHeadChargen.tri` behind RaceMenu's `CME_JawWidth` carries
`JawNarrow`/`JawWide` and holds no `EFM_`-prefixed morph at all. Each measurement now writes only the
highest-priority family the install offers and the head can move; a single family's own fan-out is
left alone.

Only fires when a slider inventory is loaded — without one FaceForge writes EFM alone, which is why
exports made before loading an inventory were unaffected.

**Guessed baselines are capped.** A baseline is a divisor, so a small wrong one is a multiplier, not
a bias. On the reported export every *measured* baseline put the face within 10% of neutral
(nose -7%, jaw -10%) while every *guessed* one threw it to the end of the range (brow height +70%,
brow width +78%, brow thickness +168%). 0.19.0 was right to refuse to calibrate these against a
render — Skyrim's brows and irises are textures, so the neutral head has no brow geometry — but the
estimate was still handed a measurement's authority. `browHeight`, `browWidth`, `browThickness`,
`irisSize` and `lipGap` now keep direction and ordering but cap at 30% of family range. `browAngle`
divides degrees rather than a baseline and is excluded.

Net on the reported preset: EFM_Brow_Height 2.30 -> 0.90, EFM_Brow_Width 2.43 -> 0.90,
EFM_Brow_Thickness 2.93 -> 0.90, EFM_Oral_Height -2.16 -> -0.90, nine duplicate sliders dropped,
and everything on a measured baseline (jaw, nose, cheeks, mouth width) unchanged.

**0.24.1 then removed three of the five guesses entirely.** The rendered numbers had been in
`qa/race-calibration.json` since 0.20.0 and pass 0.19.0's own acceptance rule (reject only when the
heads disagree by more than half the mean): browWidth 4.0% spread, browThickness 8.5%, browHeight
24.3%. The guesses they replace were 40%, 63% and 30% low. Only irisSize (51.2%) and lipGap (169.2%)
genuinely fail the rule; they stay estimated and capped, with their values moved to the measured
median so they no longer sit at the extreme of the observed range. The three 0.90s above become
0.80, 0.28 and -0.02 -- measurements rather than the limiter.

**0.24.1 also detects a covered forehead.** MediaPipe returns brow landmarks whether or not a brow
is visible, so a fringe was being measured as a brow. FaceForge now compares cheek, forehead and
brow patches from the analysed frame and fades the brow axes when the forehead is not skin. The
brow band corroborates by material match with the forehead, not by difference from skin, so a cast
shadow is damped rather than trusted.

## Measured on this installation, 2026-08-05

| head | vertices | registered sliders | live | inert |
|---|---|---|---|---|
| vanilla female | 996 | 148 | 86 | 62 |
| vanilla male | 898 | 104 | 89 | 15 |
| High Poly Head female | 3832 | 148 | 35 | 113 |
| High Poly Head male | 3598 | 104 | 38 | 66 |

**51 EFM sliders are live on the vanilla head and inert on High Poly Head.** Expressive Facegen
Morphs registers its extension against `Actors\Character\Character Assets\FemaleHeadChargen.tri` and
ships 996-vertex morphs; the HPH head is 3832, and nothing on this install registers an EFM
extension against the `KL\High Poly Head` path. The EFM sliders that survive on HPH are the ones
whose morphs sit on the eye and mouth meshes, which HPH does not replace.

This corrects a documented assumption in `hphCalibration.ts` ("High Poly Head ships its own
EFM-compatible morphs"). It is a gating question, not a gain question — the response-gain
conclusion in that file is unaffected.

Reproduce: `dotnet run --project src/FaceForge.Core.Tests -- --morphs "<Data>" NordRace`.

## Handoff questions from the FollowerForge session, answered

1. **Does RaceMenu's Export Head bake slider shaping into vertices?** Yes.
   `qa/measure-exported-head.py` fits an exported head against the full 122-morph vanilla set with
   each opposed pair as one bounded variable. The FaceForge-built Inoue export leaves **58.6%** of
   its displacement outside that set; the hand-made, sculpt-carrying Silvia export leaves **57.9%**.
   Two heads built by different routes retain the same proportion of non-vanilla shape, so extension
   morphs and sculpt alike survive into the exported geometry. The jslot carries no vertex data; the
   exported NIF does. An unconstrained fit is worthless here — it puts +6978 on `CheeksUp` against
   −6976 on `CheeksDown` and "explains" anything.
2. **Does FaceForge derive the skin tone?** No. It writes no `tintInfo` at all; a fresh template
   ships `tintInfo: []`. The RGB(206,205,204) darkening in the reported preset came from the
   foundation preset the user loaded.
3. **Head part `type` ordinals.** FaceForge writes head parts as `{ formIdentifier }` with no `type`
   field. The ordinals in the reported preset are inherited from the foundation. RaceMenu resolves
   by FormID, which is consistent with the preset loading correctly.

## Runtime boundary

No runtime confirmation of 0.24.0. The before/after values are computed from the shipped formula and
the defects are measured from installed files; neither is an in-game observation. The user-side test
is to re-export the same photograph with 0.24.0 and load it on the same HPH character -- the brows
should read as brows rather than as slabs, and the rest of the face should be recognisably the shape
0.23.2 produced. SSEEdit, xEdit, and Creation Kit were not launched. Skyrim Data, Vortex staging,
CharGen, and installed tools stayed read-only.

## Next useful work

1. **Calibrate irisSize and lipGap.** Three of the five were adopted in 0.24.1; these two fail the
   disagreement rule and remain estimates on a cap. lipGap varies 169% across rendered heads because
   a closed mouth's lip separation is near zero and noise dominates; irisSize varies 51% because two
   of twenty heads are outliers (DarkElf male 0.0707, Elder male 0.1177) and the iris is a texture on
   a sphere. Either needs a different reference than a neutral render -- a rendered head wearing a
   real brow/eye head-part, or a photo corpus -- not another guess.
2. **Validate occlusion detection against real photos.** The thresholds (0.10 skin variation, 0.22
   occluder distance) are set from the pale-skin/brown-fringe case that prompted it and from the
   fact that a false positive is cheap. They have not been swept over a range of skin tones,
   lighting, or head coverings. This is the highest-value next measurement.
3. **Transfer EFM morphs to High Poly Head topology.** The morphs exist at 996 vertices and HPH is a
   subdivision of the same head with the same UVs, so a barycentric transfer would make ~51 sliders
   live again rather than merely honest. This is the single largest remaining fidelity gain and it
   is bounded work; it needs its own version and a render-and-measure check.
4. **Read slider inis out of BSAs.** ECE Sliders for Racemenu ships its `morphs.ini`/`races.ini`
   inside a BSA, so its CME/SPG sliders are invisible to the registry and fall through to the
   permissive path. BSArch cannot unpack that archive (it lists but extracts nothing), so this needs
   a BSA reader rather than a shell-out.
5. Calibrate the reliability thresholds against a small real-photo set, especially turned faces; the
   current 12% asymmetry and 180-pair gates deliberately catch the known 26% / 155-pair defect.
6. The diagnostic preview draws `correctedLandmarks`, which mirror-averaging only symmetrises for
   paired points — 155 of 478 on the known turned photo — so the contour ring alternates between
   symmetrised and raw points and reads as a sawtooth. Cosmetic; measurements are unaffected because
   the measurement landmarks are always paired.
