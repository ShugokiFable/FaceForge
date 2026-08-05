<div align="center">

# FaceForge

**Turn a photograph into an editable Skyrim RaceMenu starting preset.**

Local-first Windows app. Indexes your installed Skyrim/Vortex/CharGen read-only, measures faces with MediaPipe, and exports exact head-part records with real plugin requirements. Slider baselines come from **measured CharGen heads**, not hand-waved guesses.

[![Release](https://img.shields.io/github/v/release/ShugokiFable/FaceForge)](https://github.com/ShugokiFable/FaceForge/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2064--bit-lightgrey)]()
[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4)]()

</div>

---

## Current release: 0.23.0

Download the one-file app from the [latest release](https://github.com/ShugokiFable/FaceForge/releases/latest):

**`FaceForge-0.23.0-STANDALONE.exe`**

| | |
|--|--|
| Size | 125,958,832 bytes |
| SHA-256 | `E13C9B656C418C4086F4894F244AB3A3514ACE999B799996C64CE89E7CF77507` |

Double-click it. No install, no ZIP unpack, no .NET SDK. Microsoft Edge WebView2 Runtime is the usual Windows prerequisite (already present on most Win10/11 systems).

---

## What it does

1. Finds Skyrim and indexes the active Vortex deployment and CharGen folders **read-only**.
2. **Quick photo** (one front image) or **Guided multi-view** (front/left/right, or frames from a slow turn video).
3. Analyzes locally with MediaPipe — detection recovery, tilt straighten, turn/nod correction, mirror-average, expression fade.
4. Suggests geometry-only race foundations from the **eight playable non-beast races** (measured from real `HeadRaces.tri` morphs). Never ethnicity classification; near-ties are labelled instead of faked confidence.
5. You pick **target race and sex** from playable RACE records; that gates every head-part list and sets race-relative slider baselines.
6. Prefer **High Poly Head** face/brows when the install has them; HPH exports use calibrated EFM response and declare empty sculpt host TRIs (no invented vertex deltas).
7. Writes only **live** RaceMenu morphs for the head you chose — inert extension sliders are dropped so a player-looking preset does not go flat on a follower with a different mesh topology.
8. Search exact installed hair, brow, eye, facial-hair, scar, and face-mesh **HDPT** records with `plugin|FormID`, Vortex source mod, masters, and missing requirements.
9. Export a **RaceMenu Preset Pack**, **RaceMenu Head Export** stage, or preserved-source **Follower Head Kit**. Finished presets can be re-checked for real share requirements.

Optional vision refinement (Codex / Claude / Gemini CLI, or OpenRouter) only runs after you press Refine and consent once. FaceForge never reads provider login tokens.

---

## Highlights since 0.11.0

| Area | What landed |
|------|-------------|
| **Live morphs (0.23)** | Install-aware MorphRegistry: omit sliders the target head cannot move (HPH/EFM mismatch fix for follower flat face). |
| **Reliability & vision (0.22)** | Source reliability verdict; adaptive full vision interpretation for stylized/unreliable sources. |
| **Measured heads** | Universal baselines and per-race foundations from rendered CharGen / race TRI morphs. |
| **Race ranking** | Measurement-space ranking, Elder removed from recommendations, near-ties labelled. Not an ethnicity detector. |
| **Detection & pose** | Detection ladder, multi-face pick, tilt re-detect. Aggressive turn-half blend from 0.21.0 was **withdrawn** in 0.21.1. |
| **HPH** | Install-aware High Poly Head prefer; empty sculpt host declaration (no invented vertex deltas). |
| **Sliders** | Install-learned inventory, family ranges, sex touch-up and optional geometry styles. |
| **Presets** | Finished-preset requirement recompute; BSA/ESL head-part resolve fixes. |

Full history: [CHANGELOG.txt](CHANGELOG.txt).

---

## Honest limits

- Output is a **RaceMenu starting preset**, not a finished follower. FaceGen NIF/DDS only come from saving in RaceMenu in-game; FollowerForge builds the NPC plugin afterward.
- **Sculpt vertex deltas are not invented.** Host TRI paths can be declared empty for HPH topology; likeness finish is RaceMenu Sculpt / F5–F9.
- Depth/projection and tooth sliders are not invented from a single front photo.
- Badly posed photos can still look confident in the UI; check analysis warnings.
- Race ranking is morph/geometry guidance, not real-world ethnicity analysis.

---

## Build from source

Active ship tree: [`FaceForge 0.23.0/`](FaceForge%200.23.0/)

Requirements: Windows x64, .NET SDK 8+, Node.js 20+ (pnpm via corepack is fine).

```powershell
cd "FaceForge 0.23.0"
.\build.ps1
.\package.ps1
```

Result: `artifacts\FaceForge 0.23.0 - STANDALONE.exe` (GitHub Releases use `FaceForge-0.23.0-STANDALONE.exe`).

---

## Source layout

| Path | Role |
|------|------|
| `FaceForge 0.23.0/src/FaceForge.Web` | Analysis UI, MediaPipe, template engine |
| `FaceForge 0.23.0/src/FaceForge.Core` | Discovery, Vortex/CharGen index, TRI reader, MorphRegistry, packaging |
| `FaceForge 0.23.0/src/FaceForge.Desktop` | WPF + WebView2 host |
| `FaceForge 0.23.0/src/FaceForge.Core.Tests` | Native validation tests |
| `FaceForge 0.23.0/qa` | Browser QA, head render/calibration scripts |

---

## Related

- [FollowerForge](https://github.com/ShugokiFable/FollowerForge) — build the NPC plugin after RaceMenu bakes the head.
- [Skyrim Forge](https://github.com/ShugokiFable/skyrim-forge) — typed Skyrim automation broker.

Vortex staging, Skyrim `Data`, CharGen, saves, and profiles are always **read-only** evidence. FaceForge never edits your load order.
