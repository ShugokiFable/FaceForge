# FaceForge 0.24.2

Bug-fix release. Everything here came from reports on the Nexus page. The measurement
pipeline is untouched — a preset exported by 0.24.1 and one exported by 0.24.2 are identical.

## Fixes
- **OpenRouter 404 on every model** — FaceForge pinned three provider-routing filters at once
  (`zdr`, `data_collection`, `require_parameters`). Routing clauses intersect, and demanding
  zero-data-retention endpoints *and* strict structured-output support left no endpoint for any
  model; OpenRouter reports an empty pool as HTTP 404. Only `data_collection: "deny"` is kept —
  the clause that protects the photograph. Responses are now parsed leniently (fenced or
  prose-wrapped JSON), and errors repeat what OpenRouter actually said.
- **Export button unreachable on small screens** — root `overflow: hidden` plus a 680px
  `min-height` clipped the bottom row on a 1366×768 laptop at 125% scaling. Now scrolls.
- **Mod Organizer 2** — FaceForge detects the USVFS injection and explains that it should be run
  directly instead of showing a bare "could not initialize webview2". It reads the same mods
  either way. Running under MO2 is still not supported.
- **"loaded 4/4" and "missing" at once** — a plugin found but whose source mod couldn't be named
  rendered as missing. Now reads "present, source mod not identified".

## New
- **Warning when Expressive Facegen Morphs is absent** — FaceForge writes only the `EFM_` slider
  family. Without EFM active, RaceMenu silently ignores every value and the character loads as the
  race default, identical whatever photo was used. The app now says so.

## Known, not fixed
- One report describes a generic in-game result with EFM present. The EFM warning does not explain
  that, and it is still open.
- No photograph guidance yet. There is still no way to know what camera angle the side-view check
  will accept.

## Download
`FaceForge-0.24.2-STANDALONE.zip` — unzip anywhere, run the EXE. Windows **tool**, not a Skyrim mod.
Do not install into Skyrim `Data`, Vortex, or MO2.

Zip: 119143381 bytes
SHA-256: `5C48103F6D8F0F26CDF5A676096D9CC8AEBE0D9DC4F3FCF6E97C9804BC765B25`
