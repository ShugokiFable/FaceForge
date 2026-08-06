# FaceForge state

- Active version: `FaceForge 0.24.0` (parent 0.23.2), tool-validated release.
- Final EXE: `FaceForge-0.24.0-STANDALONE.exe`, 125,966,822 bytes.
- SHA-256: `D894A4022D9F530E04CF0BE12151EDAA43EC66592184B9EA27A5A25ADF1477A2`.
- FileVersion 0.24.0.0.
- Tests: 82 frontend (10 new), 96 native assertions. TypeScript clean, .NET Release clean, 0 warnings.
- Product version: `0.24.0`; public distribution remains exactly one self-contained EXE.

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

1. **Measure the five estimated baselines properly.** The 30% cap is a guard, not a calibration --
   it bounds a wrong divisor rather than replacing it. The brow and iris baselines cannot come from
   a render of the neutral head, so they need either a hand-authored-preset regression (fit the
   baseline that puts the six MEMORY presets at their observed mean) or a rendered head wearing an
   actual brow head-part. Until then the cap stands and those five axes are deliberately gentle.
2. **Transfer EFM morphs to High Poly Head topology.** The morphs exist at 996 vertices and HPH is a
   subdivision of the same head with the same UVs, so a barycentric transfer would make ~51 sliders
   live again rather than merely honest. This is the single largest remaining fidelity gain and it
   is bounded work; it needs its own version and a render-and-measure check.
3. **Read slider inis out of BSAs.** ECE Sliders for Racemenu ships its `morphs.ini`/`races.ini`
   inside a BSA, so its CME/SPG sliders are invisible to the registry and fall through to the
   permissive path. BSArch cannot unpack that archive (it lists but extracts nothing), so this needs
   a BSA reader rather than a shell-out.
4. Calibrate the reliability thresholds against a small real-photo set, especially turned faces; the
   current 12% asymmetry and 180-pair gates deliberately catch the known 26% / 155-pair defect.
5. The diagnostic preview draws `correctedLandmarks`, which mirror-averaging only symmetrises for
   paired points — 155 of 478 on the known turned photo — so the contour ring alternates between
   symmetrised and raw points and reads as a sawtooth. Cosmetic; measurements are unaffected because
   the measurement landmarks are always paired.
