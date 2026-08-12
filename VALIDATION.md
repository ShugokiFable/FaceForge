# FaceForge 0.24.3 validation

Status: tool-validated standalone release. In-game likeness is untested, and the OpenRouter
fix is not runtime-confirmed — see "Not verified" below.

0.24.2 is withdrawn. It passed every gate below except the one that mattered: nobody looked at
the rendered page. Its layout regression is recorded in CHANGELOG and DECISIONS.

## Authority and version gate

- Authoritative project: `FaceForge`; parent: 0.24.2 (withdrawn); active: 0.24.3.
- Snapshot created by full copy of 0.24.2 with build outputs excluded (node_modules, dist,
  bin, obj, artifacts, TestResults, mediapipe wasm, embedded web bundle).
- Version strings bumped in build.ps1, package.ps1, README.md, ExportPackager.cs,
  OpenRouterVision.cs, EmbeddedWebBundle.cs, FaceForge.Desktop.csproj, package.json,
  AboutModal.tsx, racemenu.ts. Historical references in `faceAnalysis.ts` left as written.
- Game, Vortex, MO2, CharGen, and installed-tool trees were read-only. SSEEdit / xEdit /
  Creation Kit not launched.
- CURRENT, VERSION, CHANGELOG, STATE, DECISIONS, GITHUB, NEXUS-RELEASE, and VALIDATION updated.

## Rendered layout

Vite dev server against the installed build cache, measured through the browser rather than
asserted from the stylesheet.

- 1092x614 (a 1366x768 panel at 125% scaling): shell 680px tall, `#root` scrollable
  (scrollHeight 680 vs clientHeight 614), `.status-rail` bottom at 680 before scrolling and
  fully inside the viewport after scrolling 66px. Workspace panels fixed at 562px; the output
  panel scrolls internally over 2720px of content.
- 1280x720: shell height 720px, exactly equal to the viewport, no page scroll on `#root` or
  the document. All three workspace panels 602px — unchanged from 0.24.1 behaviour.

## Build and package

- `package.ps1`: PASS.
- Frontend: 9 files / 100 tests PASS.
- Native core: 96 assertions PASS, 1 preset, 4 plugins.
- TypeScript build + Vite production build: PASS.
- .NET Release: 0 warnings / 0 errors.
- Publish single-file gate: one `FaceForge.exe`.
- Launch check: packaged EXE ran for 14 seconds and was then stopped. FileVersion 0.24.3.0.
- EXE: `FaceForge-0.24.3-STANDALONE.exe`, 125,978,736 bytes,
  SHA-256 `73BF90EA0A2A5B4D52E19BB7DABF592AB13BA192F5F4C7A8F42F2DFFE2D200E0`.
- ZIP: `FaceForge-0.24.3-STANDALONE.zip`, 119,141,039 bytes,
  SHA-256 `4B3B01A0D4868D92897E22EABB0057958F1F30D071ADD03A92CFF57D84596F05`,
  containing the EXE and README.md only.

## Coverage added since 0.24.1

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
- **The layout was measured, not seen.** Element geometry was read from the live page; no
  screenshot was captured, so nothing rules out a purely visual defect that does not move a box.
- **In-game likeness is untested**, as in every prior release. The EFM warning addresses a known
  silent-failure path; it does not close the open report of a generic result with EFM present.

## Standing gap

`qa/browser-qa.mjs` is not part of `build.ps1`. A CSS change can therefore reach a published
build with every gate green, which is exactly how 0.24.2 shipped.
