# FaceForge 0.17.0 validation

Status: tool-validated standalone release. HPH calibration and empty host shells checked
against MEMORY jslot re-mine and unit tests. In-game likeness and RaceMenu sculpt finish
remain user-side.

## Inputs and authority

- Required FaceForge 0.16.0 source and standalone: present.
- Active project: FaceForge 0.17.0; parent/rollback: FaceForge 0.16.0.
- MEMORY HPH presets + YUYOU PRESET 2 re-parsed for morphs.custom / morphs.sculpt.
- Codebase-memory MCP used headlessly (list_projects, search_graph, index_repository).
- Skyrim Data, Vortex staging, CharGen, installed tools, downloads were read-only.
- SSEEdit/xEdit/Creation Kit were not launched.

## Build gate

- Frontend vitest: 55 passed.
- Native Core.Tests: 71 assertions PASS.
- package.ps1: clean publish, single-file EXE.

## Package

- Path: `FaceForge 0.17.0 - STANDALONE.exe`
- Length: 125911014
- SHA-256: D5F3D8C8B244BB2AEDCBA9AC9B29E0EF7546D26E95311248D3D5710D090548A5

## Unresolved

- Real sculpt dx/dy/dz synthesis (needs landmark↔TRI map + F5/F9 path).
- Male HPH eyes/brows host evidence (none in MEMORY yet).
- RaceMenu visual QA of HPH gain/factors.

---
# FaceForge 0.9.0 validation

Status: tool-validated standalone release. Pose correction, expression distrust, and the new
crop-and-straighten scan pass all check out against automated, synthetic-geometry, and
real-portrait evidence. In-game likeness, the RaceMenu head bake, and Follower Forge construction
remain open, as does correction quality across a wide photographic sample.

## 0.9.0 foundation audit

The 0.1.0-0.6.0 code inherited from the previous author was reviewed in full. Environment
discovery, Vortex manifest reading, plugin header parsing, CLI sandboxing (`--sandbox read-only`,
tool denial, three-minute timeouts, response size caps), cmd argument quoting, and structured
response validation were all sound and were left alone. Three defects were found:

- `sourceKind` and `hasLocalAnalysis` were sent with every vision request by the frontend and
  discarded by the desktop bridge, so the prompt could not distinguish refinement from
  interpretation or photograph from illustration. Fixed.
- Vision refinement deltas were bounded at +/-3. That was a third of the pre-0.7.0 slider range
  but is the entire range now, so a refinement could invert the local measurement. Bounded at
  +/-1 for refinement; interpretation from neutral keeps +/-3. Fixed.
- Refinement notes were written into the correction record but not into the warning list the
  analysis panel renders, so the straightening added in 0.8.0 was never reported to the user.
  Fixed.

## Inputs and authority

- Required FaceForge 0.8.0 source and standalone: present.
- Active project: FaceForge 0.9.0; parent/rollback: FaceForge 0.8.0.
- Five installed reference preset mods re-parsed for the sculpt-format analysis in ROADMAP.md.
- Skyrim Data, Vortex staging, CharGen, installed tools, supplied downloads, and reference vaults
  were read-only throughout. SSEEdit/xEdit/Creation Kit were not launched.

## Defect reproduction

- FaceForge 0.7.0 emitted only warnings for tilt, turn, and non-neutral expression, then wrote the
  contaminated measurements into the preset unchanged.
- Re-importing the QA portrait tilted 16Â° with landmark-only de-rotation drifted the exported
  sliders by 0.581 worst case (`EFM_Brow_Height`) and 0.088 mean.
- A control run that re-encoded the same portrait through the same canvas at 0Â° produced exactly
  zero drift on all 35 sliders, so resampling is not the cause; the drift is the landmark model
  reading a rotated image differently.

## Implemented semantic behavior

- A source tilted more than 4Â° is rotated upright and detected a second time; the residual tilt is
  then rotated out geometrically. Detection falls back to the first pass if straightening loses
  the face.
- Turn and nod are estimated from landmark depth and un-foreshortened by `1/cos(angle)` up to 32Â°.
- Past 32Â°, correction stops and `widthConfidence` / `heightConfidence` fall instead, fading the
  affected measurements toward neutral.
- The mesh is mirror-averaged about its own symmetry axis. The seventeen bilateral measurement
  landmarks come from a fixed table; contour points are matched by mutual nearest neighbour within
  3.5% of face width for the diagnostic mesh only.
- Fourteen expression rules fade only the measurements each expression physically moves, each with
  a dead zone for resting muscle tone and a saturation point past which the measurement is fully
  discarded. Pose and expression factors compound.
- Reported values distinguish what was corrected from what was discarded, in the analysis panel
  and on the individual sliders.

## Semantic tests

Frontend, 39 tests across 4 files. The 13 source-correction tests added in 0.8.0:

- A mesh rotated 14Â° measures identically to the unrotated original across all 30 measurements.
- The removed tilt is reported, not hidden.
- A mesh yawed 18Â° under a weak-perspective projection recovers its front-facing jaw width and
  face aspect; the uncorrected projection is verifiably narrower.
- Turn direction and magnitude are detected with the correct sign.
- A face with one side of the mouth and jaw dragged out and down becomes symmetric: residual
  asymmetry drops below 0.001% and every key pair ends equidistant from the axis at equal height.
- An asymmetric brow reports the average tilt, strictly between zero and the one-sided value.
- A 48Â° turn is not corrected; confidence falls below 0.7 and the note says so.
- `jawOpen: 0.7` drops mouth-vertical trust below 0.05 and returns the measurement to the baseline,
  while eye spacing is untouched.
- `eyeBlink: 0.8` drops eye-openness trust below 0.05 and names the cause.
- A mild smile at 0.3 leaves mouth-width trust between 0.4 and 0.9 rather than discarding it.
- Held measurements surface as slider confidence, and a held slider exports 0 rather than a wrong
  number.
- A clean front-facing neutral source is left completely untouched: no rotation, full confidence
  on every measurement, and a single note saying no correction was needed.
- Pose residual and expression contamination compound multiplicatively.

Existing 0.7.0 regressions all still pass, including the EFM range, the preset-band distribution,
and the brow-angle fix.

## Browser QA, real portrait through the real landmark model

- Clean run: 35 sliders, max |value| 1.750, mean 0.632, zero at the limit, format version 3.
- Reported pose on the clean source: tilt âˆ’0.2Â°, turn 1.5Â°, nod 3.6Â°. Nothing held at neutral, no
  slider flags â€” the estimator does not invent rotation out of landmark noise.
- Rotated-source stage: the same portrait re-imported at 16Â° reports 15.7Â° and produces sliders
  within 0.084 worst case and 0.018 mean of the straight run. With straightening alone (0.8.0)
  this was 0.154; with neither pass it was 0.581.
- Small-face stage: the portrait pasted into a frame three times larger reframes (confirmed by the
  rendered note, not only by the numbers) and produces sliders within 0.063 worst case and 0.016
  mean of the tightly framed run.
- Target race/sex block, five head-part category tabs, gate counter, baked-head step, and the new
  source-correction readout all render.
- No console errors, no page errors, no failed requests, no HTTP errors.

## Build and packaging

- Frontend: 4 test files / 39 tests PASS.
- Native core validation: 58 assertions PASS, including the vision-context bounds, both prompt
  variants, the style instruction, the CLI prompt bound, the schema bound, and rejection of an
  out-of-range refinement delta.
- TypeScript project build and Vite production build: PASS.
- .NET Release build: 0 warnings / 0 errors.
- Single-file publish gate: exactly one published file, `FaceForge.exe`.
- Isolated launch: the standalone EXE was copied alone into an empty folder, launched, and was
  still running after 18 seconds without creating adjacent files or directories.

## Not validated

- Correction quality across a wide range of real photographs. The evidence is synthetic geometry
  plus one real portrait re-imported at one tilt angle and one framing.
- Any live vision request. The context plumbing and bounds are covered by native assertions, but
  no request has been sent to a provider.
- Real turned and nodded photographs. Yaw and pitch recovery is proven against a synthetic
  weak-perspective projection, not against a camera.
- The expression weights. They encode which measurement an expression moves and roughly how
  completely; they are not calibrated against neutral/expressive pairs of the same person.
- In-game likeness of a corrected face.
- RaceMenu accepting each selected head-part record for the chosen race and sex.
- RaceMenu writing the companion NIF/DDS during the in-game preset save.
- Follower Forge building an NPC plugin from a FaceForge-originated baked head.

Runtime status: tool-validated. Nothing in this release has been confirmed in a running game.

## FaceForge 0.12.0 (2026-07-30)

- Frontend tests: 47 passed (5 files) via `build.ps1` / vitest.
- Native core: 71 assertions PASS.
- Desktop build: 0 warnings / 0 errors.
- Single-file publish: one `FaceForge.exe` only.
- Package: `FaceForge 0.12.0 - STANDALONE.exe` 125,898,781 bytes
  SHA-256 `28137907529B3522C57C8098EBBA14C5042382730C9EE74A6216B08120901825`.
- Isolated launch: process stayed alive 8s with only the EXE present.
- Browser QA on the expanded photographic failure set (dark / rotated / multi-face real photos)
  remains user-side; unit tests cover primary-face selection and race-baseline slider shifts only.
- Runtime status: tool-validated (not user-confirmed RaceMenu load).

## FaceForge 0.13.0 (2026-07-30)

- Frontend tests: 48 passed (5 files).
- Native core: 71 assertions PASS.
- Desktop build: 0 warnings / 0 errors.
- Single-file publish: PASS.
- Package: `FaceForge 0.13.0 - STANDALONE.exe` 125905160 bytes
  SHA-256 `1B91644037B30C514A6A71F5649ECB1FBD15E16B3018CAC3497C21796C681BFC`.
- Runtime status: tool-validated.

## FaceForge 0.14.0 (2026-07-31)

- Frontend tests: 49 passed.
- Native core: 71 assertions PASS.
- Package: `FaceForge 0.14.0 - STANDALONE.exe` 125909288 bytes
  SHA-256 `5DB2FB360FB1CAC2194B7A548C91CB299FB5D2FC499A43B2B695A3A1163A56D7`.
- Evidence: YUYOU PRESET 2 EFM axes archived under MEMORY\shape-style-references.
- Hitomi jslot inspected: UBE-only, not used for numeric targets.
- Runtime status: tool-validated.

## FaceForge 0.15.0 (2026-07-31)

- Frontend: 52 tests PASS.
- Package: 125913374 bytes SHA-256 `9DD7828DDD2AA67B6131198EAD5CF134C432EB65BAB3679B3B8B3677D24AC1A5`.


