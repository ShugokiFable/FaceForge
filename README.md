<div align="center">

# FaceForge

**Turn a photograph into an editable Skyrim RaceMenu starting preset.**

Local-first Windows app. Indexes your installed Skyrim/Vortex/CharGen read-only, maps a face with MediaPipe, and exports exact head-part records with real plugin requirements.

[![Release](https://img.shields.io/github/v/release/ShugokiFable/FaceForge)](https://github.com/ShugokiFable/FaceForge/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2064--bit-lightgrey)]()
[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4)]()

</div>

---

## Current release: 0.11.0

Download the one-file app from the [latest release](https://github.com/ShugokiFable/FaceForge/releases/latest):

**`FaceForge 0.11.0 - STANDALONE.exe`**

Double-click it. No install, no ZIP unpack, no .NET SDK. Microsoft Edge WebView2 Runtime is the usual Windows prerequisite (already present on most Win10/11 systems).

---

## What it does

1. Finds Skyrim and indexes the active Vortex deployment and CharGen folders **read-only**.
2. **Quick photo** (one front image) or **Guided multi-view** (front/left/right, or frames from a slow turn video).
3. Analyzes locally with MediaPipe — tilt straighten, turn/nod correction, mirror-average, expression fade.
4. Suggests geometry-only race foundations from installed EFM human races (never ethnicity classification).
5. You pick **target race and sex** from playable RACE records; that gates every head-part list.
6. Search exact installed hair, brow, eye, facial-hair, and scar **HDPT** records with `plugin|FormID`, Vortex source mod, masters, and missing requirements.
7. Export a **RaceMenu Preset Pack**, **RaceMenu Head Export** stage, or preserved-source **Follower Head Kit**.

Optional vision refinement (Codex / Claude / Gemini CLI, or OpenRouter) only runs after you press Refine and consent once. FaceForge never reads provider login tokens.

---

## New in 0.11.0

- **Finished-preset check** — re-reads a `.jslot` after RaceMenu edits and recomputes real requirements (head parts, plugins, Vortex provenance, share-ready blockers).
- **BSA-packed head parts** resolve by parsing the part’s own plugin on demand.
- **ESL head parts** resolve correctly (RaceMenu’s `0xFE` load-index identifiers are masked before match).

See [CHANGELOG.txt](CHANGELOG.txt) for the full history (0.7.0–0.11.0: EFM ±3, source correction, slider catalog, vision fixes, and more).

---

## Honest limits

- Output is a **RaceMenu starting preset**, not a finished follower. FaceGen NIF/DDS only come from saving in RaceMenu in-game; Follower Forge builds the NPC plugin afterward.
- Skin/body/overlay packs are never mislabeled as selectable head parts.
- Depth/projection and tooth sliders are not invented from a single front photo.
- Race ranking is morph topology guidance, not real-world ethnicity analysis.

---

## Build from source

Active ship tree: [`FaceForge 0.11.0/`](FaceForge%200.11.0/)

Requirements: Windows x64, .NET SDK 8+, Node.js 20+ (pnpm via corepack is fine).

```powershell
cd "FaceForge 0.11.0"
.\build.ps1
.\package.ps1
```

Result: `artifacts\FaceForge 0.11.0 - STANDALONE.exe`

---

## Source layout

| Path | Role |
|------|------|
| `FaceForge 0.11.0/src/FaceForge.Web` | Analysis UI, MediaPipe, template engine |
| `FaceForge 0.11.0/src/FaceForge.Core` | Discovery, Vortex/CharGen index, packaging |
| `FaceForge 0.11.0/src/FaceForge.Desktop` | WPF + WebView2 host |
| `FaceForge 0.11.0/src/FaceForge.Core.Tests` | Native validation tests |
| `FaceForge 0.11.0/qa` | Browser QA, screenshots, fidelity ledger |

---

## Related

- [Follower Forge](https://github.com/ShugokiFable/FollowerForge) — build the NPC plugin after RaceMenu bakes the head.
- [Skyrim Forge](https://github.com/ShugokiFable/skyrim-forge) — typed Skyrim automation broker.

Vortex staging, Skyrim `Data`, CharGen, saves, and profiles are always **read-only** evidence. FaceForge never edits your load order.
