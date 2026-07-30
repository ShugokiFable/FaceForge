# FaceForge state

- Workspace: `Z:\Backup\!Skyrim AE\!!!SkyrimAEaiWorkspace\FaceForge`
- Parent version: `FaceForge 0.10.0`
- Active version: `FaceForge 0.11.0`
- Snapshot gate: 80 source/config files copied from 0.9.0. Regenerated trees (`bin`, `obj`,
  `dist`, `node_modules`, `artifacts`) are deliberately not copied forward and are rebuilt by
  `build.ps1` / `package.ps1`; prior release artifacts stay preserved in their own version roots.
- Authority:
  - FaceForge 0.10.0 remains the preserved rollback release.
  - FaceForge 0.11.0 is the only active writable snapshot.
  - Skyrim Data, Vortex staging, CharGen, installed tools, supplied downloads, and reference
    vaults remained read-only.
- Implemented in 0.11.0:
  - finished-preset check that recomputes a preset's requirements from its own records rather
    than from the export-time report, and adopts it as the export source;
  - on-demand parsing of a head part's own plugin, so BSA-packed mods resolve;
  - ESL head-part identifiers masked to their real local FormID before matching.
- Implemented in 0.10.0:
  - slider catalog of 109 definitions (EFM 63, CME 21, SPG 17, NSK 8) replacing the hardcoded 35;
  - slider inventory learned from a preset saved on the user's own install, because slider names
    exist only inside RaceMenu at runtime; without one, the EFM family alone is written;
  - per-family ranges measured from the reference presets: EFM +/-3, CME/NSK/SPG/RANs +/-1;
  - integer type selectors (CME_NoseType and friends) never written as morph values;
  - nine new measurements: inner/outer eye corner width, upper/lower lid curve, canthal tilt,
    iris size (from the model's refined iris landmarks), brow thickness, lip fullness, lip gap;
  - likeness strength defaults to full instead of 70%.
- Implemented in 0.9.0:
  - audit of the 0.1.0-0.6.0 foundation; discovery, manifest reading, CLI sandboxing, process
    quoting, and response validation were sound, three defects were found and fixed;
  - vision requests now carry `sourceKind` and `hasLocalAnalysis`, which the desktop bridge had
    been discarding, and the prompt states which job it is doing;
  - vision refinement deltas bounded at +/-1 instead of +/-3, since +/-3 is now the entire slider
    range; interpretation from neutral keeps the full range;
  - refinement notes now reach the warning list, not only the correction record;
  - the second detection pass crops to the face as well as straightening it, recovering landmark
    precision on a face that fills only part of the frame.
- Carried from 0.8.0:
  - two-pass detection that straightens a tilted image before landmarking, then rotates out the
    residual tilt geometrically;
  - turn and nod estimated from landmark depth and un-foreshortened up to 32°, past which the
    affected measurements lose confidence instead of being scaled further;
  - mirror-averaging of the landmark mesh, with a fixed table for the seventeen bilateral
    measurement landmarks and mutual-nearest matching for cosmetic contour points;
  - fourteen expression rules that fade only the measurements each expression physically moves,
    compounding with the pose residual;
  - a Source correction readout, a named list of measurements held at neutral, and per-slider
    "neutral" / percentage flags in the output panel.
- Carried from 0.7.0: EFM range ±3 with tanh compression, the brow-angle fix, HDPT-record head-part
  gating by Type/Flags/ValidRaces, the installed-RACE target selector, and the corrected
  RaceMenu → Follower Forge round trip.
- Source/config diff against 0.10.0: 1 file added (`PresetInspector.cs`), 0 removed, 9 changed.
- Rollback artifacts preserved in each version root, most recently
  `FaceForge 0.10.0\artifacts\FaceForge 0.10.0 - STANDALONE.exe` (125,857,575 bytes).
- Automated validation:
  - frontend: 4 files / 42 tests;
  - native: 71 assertions;
  - live deployed index (unchanged from 0.7.0): 3,629 head-part records, 3,481 typed from the
    record, 3,000 with a resolved `ValidRaces` list, 10 playable races;
  - browser QA on a real portrait: max |EFM| 1.750, mean 0.632, 0 sliders at the limit, tilt
    −0.2° / turn 1.5° / nod 3.6° on a clean source, nothing held at neutral, no console or page
    errors;
  - browser QA rotated-source stage: the same portrait re-imported at a 16° tilt reports 15.7°
    and lands within 0.084 worst case and 0.018 mean of the straight run's sliders (0.154 in
    0.8.0 with straightening only; 0.581 with neither);
  - browser QA small-face stage: the portrait pasted into a frame 3x larger reframes and lands
    within 0.063 worst case and 0.016 mean of the tightly framed run;
  - control: re-encoding the portrait through the same canvas at 0° produces exactly zero slider
    drift, so the residual above is rotation, not resampling;
  - .NET build: 0 warnings / 0 errors;
  - single-file publish gate: PASS;
  - isolated final launch: stayed running 18 seconds with one file and no directories;
  - browser QA baseline without an inventory: 63 EFM sliders (was 35), max |value| 2.93, mean
    0.986, 0 pinned; rotated-source worst case 0.12, small-face worst case 0.09;
  - browser QA inventory stage against the supplied `READ_ALL_SLIDERS_TEST.jslot`: 108 sliders
    written across EFM/CME/NSK/SPG, 7 families detected, no index selector written, and
    `SPG_ECEBrowThickness` (defined by FaceForge, absent from that install) correctly dropped.
  - preset inspection against the supplied edited `Homelander.jslot`: 7 of 7 head parts resolved
    by name (2 were unresolved before the BSA and ESL fixes), 4 required plugins recomputed from
    the file against the 2 originally declared, all present with exact Vortex provenance.
- Final EXE: `FaceForge 0.11.0 - STANDALONE.exe`
  - 125,890,534 bytes, SHA-256 `E4FC3AC348E1A1C2904A8AFBCA168D7551CEFAA092D7A100C707F2B1B25796CA`.
  - Present both at the project root and in `FaceForge 0.11.0\artifacts`.
- Next command: user-side RaceMenu load at the chosen race/sex, in-game head bake, baked-head
  check, and Follower Forge construction.
- Runtime boundary: RaceMenu visual compatibility, in-game likeness, NIF/DDS materialization,
  NPC plugin construction/gameplay, and live provider calls remain untested. Correction quality is
  proven on synthetic geometry and one real portrait, not on a wide photographic sample.
