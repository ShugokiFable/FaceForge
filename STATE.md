# FaceForge state

- Active version: `FaceForge 0.23.0` (parent 0.22.0), tool-validated release.
- Final EXE: `FaceForge 0.23.0 - STANDALONE.exe`, 125,958,832 bytes.
- SHA-256: `E13C9B656C418C4086F4894F244AB3A3514ACE999B799996C64CE89E7CF77507`.
- FileVersion 0.23.0.0; isolated launch verified (still running after 12s, then stopped).
- Tests: 70 frontend (8 new), 92 native assertions (10 new). TypeScript clean, .NET Release clean.
- Product version: `0.23.0`; public distribution remains exactly one self-contained EXE.

## What changed

FaceForge no longer writes sliders the target head cannot move.

A RaceMenu slider is a name in an ini pointing at a pair of named vertex morphs. It appears in the
menu whenever some `races.ini` registers it, and it changes the face only when those morphs exist in
a `.tri` whose vertex count matches the mesh the character wears. Those two conditions are
independent, and FaceForge was only ever checking the first — by way of a slider inventory read out
of a user-supplied preset, which lists every registered slider whether it works or not.

`FaceForge.Core/MorphRegistry` now reads the installation directly:
`meshes\actors\character\facegenmorphs\<Plugin>\morphs.ini` (extension registrations),
`races.ini` (which slider set each race gets), `sliders\*.ini` (the morph pair behind each slider),
and every chargen `.tri` the character wears — head, brows, eyes, mouth. An extension whose vertex
count does not match the part it claims to extend contributes nothing and is reported as rejected.

Sliders that come out inert are left out of the preset instead of written as dead keys, and the
analysis notice says how many were dropped and why.

**The rule only ever subtracts.** A slider the registry has never heard of keeps whatever the
inventory decided. The registry reads loose files, so a slider ini inside a BSA is invisible to it —
treating "not found" as "inert" would silently delete working sliders, which is worse than the
defect being fixed. There is a test pinning that.

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

No runtime confirmation. The slider-liveness finding is measured from installed files, not observed
in game; the natural user-side test is to load a 0.23.0 preset on an HPH character and confirm the
face is no worse than 0.22.0's despite carrying ~50 fewer keys. SSEEdit, xEdit, and Creation Kit
were not launched. Skyrim Data, Vortex staging, CharGen, and installed tools stayed read-only.

## Next useful work

1. **Transfer EFM morphs to High Poly Head topology.** The morphs exist at 996 vertices and HPH is a
   subdivision of the same head with the same UVs, so a barycentric transfer would make ~51 sliders
   live again rather than merely honest. This is the single largest remaining fidelity gain and it
   is bounded work; it needs its own version and a render-and-measure check.
2. **Read slider inis out of BSAs.** ECE Sliders for Racemenu ships its `morphs.ini`/`races.ini`
   inside a BSA, so its CME/SPG sliders are invisible to the registry and fall through to the
   permissive path. BSArch cannot unpack that archive (it lists but extracts nothing), so this needs
   a BSA reader rather than a shell-out.
3. Calibrate the reliability thresholds against a small real-photo set, especially turned faces; the
   current 12% asymmetry and 180-pair gates deliberately catch the known 26% / 155-pair defect.
4. The diagnostic preview draws `correctedLandmarks`, which mirror-averaging only symmetrises for
   paired points — 155 of 478 on the known turned photo — so the contour ring alternates between
   symmetrised and raw points and reads as a sawtooth. Cosmetic; measurements are unaffected because
   the measurement landmarks are always paired.
