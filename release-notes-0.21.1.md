# FaceForge 0.21.1

**Local Windows tool:** photograph → editable Skyrim RaceMenu starting preset.

## Download

**`FaceForge 0.21.1 - STANDALONE.exe`**

| | |
|--|--|
| Bytes | 125,926,440 |
| SHA-256 | `2EA7660891E04AE71762539E9AF3FAE14B6E68A7FD6BD0B11FB2A9A44A1FA783` |

Double-click. Requires Microsoft Edge WebView2 (usually already on Win10/11). No .NET SDK install.

## This release (0.21.1)

- **Withdrew** 0.21.0’s camera-facing-half weighting. On a real 26.8° turned photo it **inflated** mirrored widths (nose, mouth, jaw, eye spacing) instead of stabilising them; every race then scored ~1%. The synthetic fixture had passed; a turned-head fix needs a real turned photograph.
- **Kept** from 0.21.0: Elder dropped from offered races; race ranking compared in **measurement space** so each race identifies its own head.
- Verified: 61 frontend tests, 82 native assertions, clean single-file package.

## Major progress since 0.11.0 (summary)

### Measured geometry (0.18–0.20)
- `TriFile` CharGen TRI reader and calibration pipeline.
- Universal measurement baselines from real heads (not neutral-guess tables).
- Per-race foundations from playable `HeadRaces.tri` morphs — fixed fabricated stereotypes (e.g. Redguard nose width).
- EXE version stamp fixed (was stuck on 0.6.0).

### Race UX honesty (0.19.1–0.21)
- Rankings use comparable dimensions; near-ties labelled.
- ElderRace removed from recommendations (aged NPC head, not a character-creation race).
- Geometry-only; **not** ethnicity detection.

### High Poly Head & export (0.15–0.17)
- Auto-prefer HPH face/brows when indexed.
- HPH-specific EFM response / midface baselines.
- Empty sculpt host TRIs declared for HPH topology — **no invented vertex deltas**.

### Detection, sliders, presets (0.10–0.14)
- Detection recovery ladder; multi-face primary pick; race-relative baselines.
- Optional sex proportion touch-up; optional geometry shape styles.
- Slider inventory from install presets; family ranges; finished-preset requirement check; BSA/ESL head-part resolve.

## Honest limits

- Starting **RaceMenu preset**, not a finished follower. Bake the head in RaceMenu; use Follower Forge for the NPC plugin.
- No guessed sculpt dx/dy/dz (finish in RaceMenu Sculpt / F5–F9).
- No depth/tooth morphs from a single front photo.
- Bad pose can still look confident — read the analysis warnings.
- Runtime likeness in-game is still user validation.

## Build from source

```powershell
git clone https://github.com/ShugokiFable/FaceForge.git
cd FaceForge\FaceForge 0.21.1
.\build.ps1
.\package.ps1
```

## Related

- [Follower Forge](https://github.com/ShugokiFable/FollowerForge)
- Full history: [CHANGELOG.txt](https://github.com/ShugokiFable/FaceForge/blob/main/CHANGELOG.txt)
