# FaceForge 0.23.0

**Local Windows tool:** photograph → editable Skyrim RaceMenu starting preset.

## Download

**`FaceForge-0.23.0-STANDALONE.exe`**

| | |
|--|--|
| Bytes | 125,958,832 |
| SHA-256 | `E13C9B656C418C4086F4894F244AB3A3514ACE999B799996C64CE89E7CF77507` |

GitHub Releases asset filename: `FaceForge-0.23.0-STANDALONE.exe` (same bytes/hash as the workspace `FaceForge 0.23.0 - STANDALONE.exe`).

Double-click. Requires Microsoft Edge WebView2 (usually already on Win10/11). No .NET SDK install.

## This release (0.23.0)

- **Follower flat-face fix:** FaceForge no longer writes RaceMenu sliders the target head cannot move. On a High Poly Head install, 51 of the EFM sliders it previously emitted were inert on that mesh.
- **MorphRegistry:** reads your install’s `facegenmorphs` tree (morphs.ini, races.ini, sliders) plus the chargen `.tri` files the character actually wears, and keeps only morphs whose vertex count matches.
- **Live vs inert:** inert sliders are omitted from the preset; the analysis notice reports how many were dropped and why. Unknown sliders (e.g. inside a BSA) are never silently deleted.
- **HPH / EFM clarity:** documented that stock High Poly Head does not ship EFM-compatible morphs; EFM extensions target the vanilla 996-vertex head, not the 3832-vertex HPH path on this install.
- **Export Head evidence:** RaceMenu Export Head bakes slider shaping into vertices; the jslot still carries no vertex data.
- **tintInfo / head-part type:** FaceForge still does not invent these; they come from the foundation preset you load.
- Verified: 70 frontend tests, 92 native assertions, clean TypeScript and zero-warning .NET Release single-file package.

## Also since 0.21.1

### Reliability & vision (0.22.0)
- Reliability verdict from source quality, pose confidence, left/right disagreement, landmarks, and near-limit sliders.
- Stylized / unreliable analyses can ask Codex, Claude, Gemini, or OpenRouter for a full ±3 interpretation on a neutral EFM face; reliable photos keep conservative ±1 local refinement.
- Visible “Vision interpretation recommended” block and adaptive vision button; local values stay editable.

### Earlier major progress (0.11–0.21)
- Measured CharGen / race TRI baselines; measurement-space race ranking; Elder removed from recommendations.
- High Poly Head prefer + empty sculpt host TRIs (no invented vertex deltas).
- Detection recovery, install-learned sliders, finished-preset requirement checks.

## Honest limits

- Starting **RaceMenu preset**, not a finished follower. Bake the head in RaceMenu; use Follower Forge for the NPC plugin.
- No guessed sculpt dx/dy/dz (finish in RaceMenu Sculpt / F5–F9).
- No depth/tooth morphs from a single front photo.
- Bad pose can still look confident — read the analysis warnings.
- Runtime likeness in-game is still user validation.

## Build from source

```powershell
git clone https://github.com/ShugokiFable/FaceForge.git
cd FaceForge\FaceForge 0.23.0
.\build.ps1
.\package.ps1
```

## Related

- [Follower Forge](https://github.com/ShugokiFable/FollowerForge)
- Full history: [CHANGELOG.txt](https://github.com/ShugokiFable/FaceForge/blob/main/CHANGELOG.txt)
