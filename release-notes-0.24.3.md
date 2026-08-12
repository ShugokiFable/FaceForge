# FaceForge 0.24.3

**0.24.2 is withdrawn** — its small-screen fix broke the panel layout at every window size.
This release carries all of 0.24.2's fixes with the layout correct.

## Fixed in this release
- **Panel layout** — 0.24.2 relaxed `.app-shell` from `height: 100%` to `min-height: 100%`.
  The shell is a `58px minmax(0, 1fr) 82px` grid, and a `1fr` track needs a definite height;
  without one the workspace panels stopped scrolling internally and grew to their full content
  length. Restored to `height: 100%` with the original `min-height: 680px` floor — which was
  always what made short viewports reachable. Only the root `overflow` ever needed to change.

  Measured in a rendered browser: at **1092×614** (a 1366×768 laptop at 125% scaling) the shell
  is 680px, the root scrolls, the status rail is fully visible after 66px, and the panels stay
  fixed at 562px with the output panel scrolling internally. At **1280×720** the shell fills the
  viewport exactly with no page scroll and all three panels at 602px — identical to 0.24.1.

## Carried forward from 0.24.2, unchanged
- **OpenRouter 404 on every model** — FaceForge pinned three provider-routing clauses at once
  (`zdr`, `data_collection`, `require_parameters`). Routing clauses intersect, and the
  intersection was empty for every model; OpenRouter reports an empty pool as HTTP 404. Only
  `data_collection: "deny"` is kept. Replies are parsed leniently and errors now repeat what
  OpenRouter actually said.
- **Mod Organizer 2** — the USVFS injection is detected and explained instead of a bare
  "could not initialize webview2". Running under MO2 is still not supported; FaceForge reads the
  same mods when run directly.
- **"loaded 4/4" and "missing" at once** — now reads "present, source mod not identified".
- **Warning when Expressive Facegen Morphs is absent** — FaceForge writes only the `EFM_` family.
  Without EFM active, RaceMenu silently ignores every value and the character loads as the race
  default, identical whatever photo was used.

The measurement pipeline is untouched — exported presets are identical to 0.24.1.

## Known, not fixed
- One report describes a generic in-game result with EFM present. Still open.
- No photograph guidance yet.

## Download
`FaceForge-0.24.3-STANDALONE.zip` — unzip anywhere, run the EXE. Windows **tool**, not a Skyrim mod.
Do not install into Skyrim `Data`, Vortex, or MO2.

Zip: 119141039 bytes
SHA-256: `4B3B01A0D4868D92897E22EABB0057958F1F30D071ADD03A92CFF57D84596F05`
