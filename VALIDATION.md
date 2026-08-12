# FaceForge 0.24.2 validation

Status: tool-validated standalone release. In-game likeness is untested, and the OpenRouter
fix is not runtime-confirmed — see "Not verified" below.

## Authority and version gate

- Authoritative project: `FaceForge`; parent: 0.24.1; active: 0.24.2.
- Snapshot created by full copy of 0.24.1 with build outputs excluded (node_modules, dist,
  bin, obj, artifacts, TestResults, mediapipe wasm, embedded web bundle).
- Version strings bumped in build.ps1, package.ps1, README.md, ExportPackager.cs,
  OpenRouterVision.cs, EmbeddedWebBundle.cs, FaceForge.Desktop.csproj, package.json,
  AboutModal.tsx, racemenu.ts. Historical references in `faceAnalysis.ts` left as written.
- Game, Vortex, MO2, CharGen, and installed-tool trees were read-only. SSEEdit / xEdit /
  Creation Kit not launched.
- CURRENT, VERSION, CHANGELOG, STATE, DECISIONS, GITHUB, NEXUS-RELEASE, and VALIDATION updated.
- A stray `package-lock.json` (from an `npm install` during diagnosis) was removed from both
  snapshots; this project ships `pnpm-lock.yaml`.

## Build and package

- `package.ps1`: PASS.
- Frontend: 9 files / 100 tests PASS.
- Native core: 96 assertions PASS, 1 preset, 4 plugins.
- TypeScript build + Vite production build: PASS.
- .NET Release: 0 warnings / 0 errors.
- Publish single-file gate: one `FaceForge.exe`.
- Launch check: packaged EXE ran for 14 seconds and was then stopped. FileVersion 0.24.2.0.
- EXE: `FaceForge-0.24.2-STANDALONE.exe`, 125,978,715 bytes,
  SHA-256 `7AF302AF5FAE190B1F190B7688FF4E3633F00114FA6BF113C4B6850089759803`.
- ZIP: `FaceForge-0.24.2-STANDALONE.zip`, 119,143,381 bytes,
  SHA-256 `5C48103F6D8F0F26CDF5A676096D9CC8AEBE0D9DC4F3FCF6E97C9804BC765B25`,
  containing the EXE and README.md only.

## Coverage added for this release

- OpenRouter routing: asserts `data_collection: "deny"` is sent and that `zdr` and
  `require_parameters` are absent. The previous suite asserted the broken routing and had to
  be corrected.
- `ExtractJsonObject`: bare object, fenced object, brace inside a string literal, prose with no
  object (rejected), truncated object (rejected).
- `DescribeFailure`: upstream error text is carried through instead of replaced.

## Not verified

- **The OpenRouter fix is not runtime-confirmed.** No live request was made — that needs a key
  and credits. The diagnosis (an empty provider pool returned as 404) is derived from the
  request FaceForge sent and from OpenRouter's documented routing behaviour, and the assertions
  cover the request shape, not the response. Structural validation is not runtime confirmation.
- **The MO2 detection was not exercised under a real MO2 launch.** The usvfs module check and
  the `MO_PROFILE` fallback are both untriggered in this environment.
- **The small-screen fix was not viewed at 1366x768 / 125%.** The CSS cause is unambiguous, but
  no capture at that size exists.
- **In-game likeness is untested**, as in every prior release. The EFM warning addresses a known
  silent-failure path; it does not close the open report of a generic result with EFM present.
