<div align="center">

# FaceForge

**Turn a photograph into an editable Skyrim RaceMenu starting preset.**

Local-first Windows app. Indexes your installed Skyrim/Vortex/CharGen read-only, measures faces with MediaPipe, and exports exact head-part records with real plugin requirements. Slider baselines come from **measured CharGen heads**, not hand-waved guesses.

[![Release](https://img.shields.io/github/v/release/ShugokiFable/FaceForge)](https://github.com/ShugokiFable/FaceForge/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2064--bit-lightgrey)]()
[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4)]()

</div>

---

## Current release: 0.21.1

Download the one-file app from the [latest release](https://github.com/ShugokiFable/FaceForge/releases/latest):

**`FaceForge 0.21.1 - STANDALONE.exe`**

| | |
|--|--|
| Size | 125,926,440 bytes |
| SHA-256 | `2EA7660891E04AE71762539E9AF3FAE14B6E68A7FD6BD0B11FB2A9A44A1FA783` |

Double-click it. No install, no ZIP unpack, no .NET SDK. Microsoft Edge WebView2 Runtime is the usual Windows prerequisite (already present on most Win10/11 systems).

---

## What it does

1. Finds Skyrim and indexes the active Vortex deployment and CharGen folders **read-only**.
2. **Quick photo** (one front image) or **Guided multi-view** (front/left/right, or frames from a slow turn video).
3. Analyzes locally with MediaPipe — detection recovery, tilt straighten, turn/nod correction, mirror-average, expression fade.
4. Suggests geometry-only race foundations from the **eight playable non-beast races** (measured from real `HeadRaces.tri` morphs). Never ethnicity classification; near-ties are labelled instead of faked confidence.
5. You pick **target race and sex** from playable RACE records; that gates every head-part list and sets race-relative slider baselines.
6. Prefer **High Poly Head** face/brows when the install has them; HPH exports use calibrated EFM response and declare empty sculpt host TRIs (no invented vertex deltas).
7. Search exact installed hair, brow, eye, facial-hair, scar, and face-mesh **HDPT** records with `plugin|FormID`, Vortex source mod, masters, and missing requirements.
8. Export a **RaceMenu Preset Pack**, **RaceMenu Head Export** stage, or preserved-source **Follower Head Kit**. Finished presets can be re-checked for real share requirements.

Optional vision refinement (Codex / Claude / Gemini CLI, or OpenRouter) only runs after you press Refine and consent once. FaceForge never reads provider login tokens.

---

## Highlights since 0.11.0

| Area | What landed |
|------|-------------|
| **Measured heads** | Universal baselines and per-race foundations come from rendered CharGen / race TRI morphs (`TriFile`, calibration QA). Estimates that contradicted the game (e.g. Redguard nose width) were replaced. |
| **Race ranking** | Comparable measurement-space ranking, Elder removed from recommendations, near-ties labelled. Not an ethnicity detector. |
| **Detection & pose** | Harder photos: detection ladder, multi-face pick, tilt re-detect. Aggressive turn-half blend from 0.21.0 was **withdrawn** in 0.21.1 after real-photo inflation. |
| **HPH** | Install-aware High Poly Head prefer; stronger HPH EFM calibration; empty sculpt host declaration (D-004). |
| **Sliders** | Install-learned slider inventory, family ranges (EFM ±3, CME/SPID-class ±1), sex touch-up and optional geometry styles. |
| **Presets** | Finished-preset requirement recompute; BSA/ESL head-part resolve fixes. |

Full history: [CHANGELOG.txt](CHANGELOG.txt).

---

## Honest limits

- Output is a **RaceMenu starting preset**, not a finished follower. FaceGen NIF/DDS only come from saving in RaceMenu in-game; Follower Forge builds the NPC plugin afterward.
- **Sculpt vertex deltas are not invented.** Host TRI paths can be declared empty for HPH topology; likeness finish is RaceMenu Sculpt / F5–F9.
- Depth/projection and tooth sliders are not invented from a single front photo.
- Badly posed photos can still look confident in the UI; check analysis warnings.
- Race ranking is morph/geometry guidance, not real-world ethnicity analysis.

---

## Build from source

Active ship tree: [`FaceForge 0.21.1/`](FaceForge%200.21.1/)

Requirements: Windows x64, .NET SDK 8+, Node.js 20+ (pnpm via corepack is fine).

```powershell
cd "FaceForge 0.21.1"
.\build.ps1
.\package.ps1
```

Result: `artifacts\FaceForge 0.21.1 - STANDALONE.exe` (also published to the repo root when packaging for release).

---

## Source layout

| Path | Role |
|------|------|
| `FaceForge 0.21.1/src/FaceForge.Web` | Analysis UI, MediaPipe, template engine |
| `FaceForge 0.21.1/src/FaceForge.Core` | Discovery, Vortex/CharGen index, TRI reader, packaging |
| `FaceForge 0.21.1/src/FaceForge.Desktop` | WPF + WebView2 host |
| `FaceForge 0.21.1/src/FaceForge.Core.Tests` | Native validation tests |
| `FaceForge 0.21.1/qa` | Browser QA, head render/calibration scripts |

---

## Related

- [Follower Forge](https://github.com/ShugokiFable/FollowerForge) — build the NPC plugin after RaceMenu bakes the head.
- [Skyrim Forge](https://github.com/ShugokiFable/skyrim-forge) — typed Skyrim automation broker.

Vortex staging, Skyrim `Data`, CharGen, saves, and profiles are always **read-only** evidence. FaceForge never edits your load order.
