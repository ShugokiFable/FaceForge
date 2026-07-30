# FaceForge 0.11.0

Local-first Windows app that turns a photograph or stylized face into an editable Skyrim RaceMenu starting preset.

## Download

**`FaceForge 0.11.0 - STANDALONE.exe`** — one file, no install. Double-click to run.

Requires Microsoft Edge WebView2 Runtime (normally already installed on Windows 10/11).

## New in 0.11.0

- **Finished-preset check.** A preset changes after FaceForge writes it: picking different eyes, hair, brows, or a head mesh in RaceMenu rewrites the head-part list, so the export-time dependency report stops describing the file. Loading a finished preset now recomputes requirements from its own records — every head part, every plugin those parts come from, Vortex provenance, slider families, sculpt hosts, tint layers, and a share-ready verdict with named blockers. The inspected preset is also adopted as the export source.
- **BSA-packed head parts resolve.** Unresolved parts trigger an on-demand parse of their own plugin, so mods that ship meshes inside a BSA are no longer invisible to the dependency report.
- **ESL head parts resolve.** RaceMenu embeds the `0xFE` light load index in identifiers; FaceForge now masks to the real local FormID before matching (same convention as Follower Forge).

Verified against an edited Homelander.jslot: 7/7 head parts resolved (2 were unresolved before), requirements expanded from 2 declared plugins to the 4 the file actually needs.

## Workflow (unchanged)

1. Launch the EXE — FaceForge indexes Skyrim / Vortex / CharGen **read-only**.
2. Quick photo or guided multi-view (or frames from a slow turn video).
3. Local MediaPipe analysis with tilt/turn/nod correction and expression fade.
4. Pick target race and sex from installed playable races; select exact HDPT hair/brows/eyes/etc.
5. Export RaceMenu Preset Pack, RaceMenu Head Export stage, or Follower Head Kit handoff.

Optional vision (Codex / Claude / Gemini CLI, or OpenRouter) only after explicit Refine + consent. No provider tokens are read from disk.

## Honest limits

- Not a finished follower — RaceMenu must bake NIF/DDS; Follower Forge builds the NPC plugin.
- Skin/body/overlay packs are never offered as head parts.
- Depth and tooth sliders are not invented from a single front photo.

## Validation (tool-validated)

- 42 frontend tests, 71 native assertions
- Browser QA across four source variants
- Clean .NET build, single-file publish gate
- Isolated one-file launch

RaceMenu visual likeness, in-game bake, Follower Forge construction, and live provider calls remain user-side validation.

## SHA-256

```
E4FC3AC348E1A1C2904A8AFBCA168D7551CEFAA092D7A100C707F2B1B25796CA
```

`FaceForge 0.11.0 - STANDALONE.exe` (125,890,534 bytes)

## Source

Ship tree: `FaceForge 0.11.0/` on `main`. Build with `build.ps1` then `package.ps1`.
