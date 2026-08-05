# FaceForge 0.22.0 validation

Status: tool-validated standalone release. Provider quality and in-game likeness are untested.

## Authority and version gate

- Authoritative project: `FaceForge`; parent: 0.21.1; active: 0.22.0.
- Full-copy parity before edits: 1,015 files / 882,770,886 bytes, zero path/length differences.
- Game, Vortex, CharGen, follower, and installed-tool trees were read-only.
- CURRENT, VERSION, CHANGELOG, PLAN, STATE, DECISIONS, REQUIREMENTS, and VALIDATION updated.

## Semantic regression

- Clean photograph fixture: local analysis remained `refine`; rendered app showed no warning.
- Anime/Art fixture: analysis switched to `interpret`, displayed the reason, and relabeled the
  action to `Interpret face with vision model`.
- Known bad-pose evidence (26% landmark disagreement, 155 surviving pairs) selects `interpret`.
- Interpretation result application starts from neutral; refinement still starts from local values.
- Native prompt/schema carries +/-3 for interpretation and +/-1 for refinement.

## Build and package

- `package.ps1`: PASS.
- Frontend: 7 files / 62 tests PASS.
- Native core: 82 assertions PASS.
- TypeScript/Vite production build: PASS.
- .NET Release: 0 warnings / 0 errors.
- Publish single-file gate: one `FaceForge.exe`.
- Skyrim release-tree validator self-test and one-EXE audit: PASS.
- Isolated launch: one copied EXE remained running after 10 seconds; no companion files required.
- Product/File versions: 0.22.0 / 0.22.0.0.

## Final package

- Path: `FaceForge 0.22.0 - STANDALONE.exe`
- Length: 125,934,029 bytes
- SHA-256: `6E808E00DDFA11AECF55944662B39FA380DE6E8FDB74A4FE0FE1F65A7C47BF44`

## Not validated

- No live provider request or provider-account login.
- No direct numeric run on the official Frieren design sheet; its asset host rejected retrieval.
- No RaceMenu preset load, external head bake, follower build, or gameplay test.
- No SSEEdit/xEdit/Creation Kit GUI use.
