# FaceForge — Nexus Mods page copy

**Version for this page:** 0.23.0  
**Primary file:** `FaceForge-0.23.0-STANDALONE.exe`  
**SHA-256:** `E13C9B656C418C4086F4894F244AB3A3514ACE999B799996C64CE89E7CF77507`  
**Size:** 125,958,832 bytes  

Use the short summary in the mod summary field. Paste the BBCode into the full description.  
Do **not** paste local disk paths, account names, or API keys.

Suggested Nexus category: **Utilities** (or **Modders Resources** if that fits your author preference).  
Suggested tags: RaceMenu, FaceGen, CharGen, tool, utility, Windows

---

## Short summary (mod card / brief)

```
Windows tool that turns a photograph into an editable RaceMenu starting preset. Indexes your Vortex/CharGen install read-only, measures faces locally with MediaPipe, and exports real head-part records with plugin requirements. Optional vision refinement only after you consent. Not a finished follower — bake the head in RaceMenu, then use Follower Forge for the NPC plugin.
```

---

## Detailed description (BBCode)

```bbcode
[center][size=5][b]FaceForge[/b][/size]
[i]Photograph → editable Skyrim RaceMenu starting preset[/i]

Local-first Windows app for Skyrim Special Edition / Anniversary Edition.
No installer. One self-contained EXE.
[/center]

[size=4][b]What it is[/b][/size]
FaceForge is an [b]out-of-game Windows utility[/b]. It does [b]not[/b] replace RaceMenu, does not inject into Skyrim, and does not edit your load order.

You give it a face photo (or multi-view photos / a slow turn video). It measures the face locally, ranks geometry-only race foundations from playable races, lets you pick race/sex and installed head parts, then writes a [b]RaceMenu preset pack[/b] (and related export options) you can finish in-game.

[size=4][b]What you get in 0.23.0[/b][/size]
[list]
[*][b]One-file app[/b] — double-click [font=Courier New]FaceForge-0.23.0-STANDALONE.exe[/font]
[*][b]Read-only[/b] discovery of Skyrim, active Vortex deployment, and CharGen folders
[*][b]Local face analysis[/b] with MediaPipe (detection recovery, pose correction, multi-view support)
[*][b]Measured baselines[/b] from real CharGen / race TRI morphs — not hand-waved slider guesses
[*][b]Live morph filter[/b] — omits RaceMenu sliders the target head mesh cannot move (helps avoid “looks right on me, flat on a High Poly Head follower” dead keys)
[*]Exact installed [b]HDPT[/b] search (hair, brows, eyes, etc.) with plugin|FormID and requirement hints
[*]Export: RaceMenu Preset Pack, Head Export stage, or preserved-source Follower Head Kit
[*]Optional vision refinement (Codex / Claude / Gemini CLI, or OpenRouter) [b]only after you press Refine and consent[/b] — FaceForge does not scrape provider login tokens
[/list]

[size=4][b]Requirements[/b][/size]
[b]Hard[/b]
[list]
[*]Windows 64-bit
[*]Skyrim Special Edition or Anniversary Edition
[*]Microsoft Edge WebView2 Runtime (already present on most Windows 10/11 systems)
[*]RaceMenu (to load and finish the preset in-game)
[/list]

[b]Strongly recommended[/b]
[list]
[*]Vortex-managed install (primary discovery path)
[*]High Poly Head if you want HPH face/brows prefer logic
[*]Expressive Facegen Morphs / other slider packs you already use for finishing
[/list]

[b]Optional[/b]
[list]
[*]A vision CLI or OpenRouter account for refinement / interpretation of difficult photos
[*][url=https://github.com/ShugokiFable/FollowerForge]Follower Forge[/url] to build the NPC plugin after you bake the head in RaceMenu
[/list]

[size=4][b]Installation[/b][/size]
[list=1]
[*]Download the EXE from Files.
[*]Put it anywhere you like (Desktop, tools folder, etc.).
[*]Double-click to run. No .NET SDK install required.
[*]Point it at your Skyrim/Vortex/CharGen paths when asked (read-only).
[/list]

[size=4][b]Suggested workflow[/b][/size]
[list=1]
[*]Import a clear front photo (or multi-view / turn video).
[*]Review analysis warnings. Fix pose if the tool says the source is unreliable.
[*]Pick target race and sex from playable records.
[*]Choose hair / brows / eyes / etc. from your installed head parts.
[*]Export a RaceMenu preset pack.
[*]In Skyrim: load the preset in RaceMenu, finish sculpt / makeup as you like, [b]Export Head[/b].
[*]Optional: build the follower with Follower Forge using that export.
[/list]

[size=4][b]Honest limits (please read)[/b][/size]
[list]
[*]Output is a [b]starting RaceMenu preset[/b], not a finished celebrity twin and not a complete follower mod.
[*]FaceGen NIF/DDS for an NPC come from RaceMenu export / your follower pipeline — FaceForge does not invent sculpt vertex deltas.
[*]Depth / projection / tooth sliders are not invented from a single front photo.
[*]Race ranking is [b]geometry guidance[/b], not real-world ethnicity detection.
[*]Badly posed photos can still look “confident” in the UI — always read the analysis warnings.
[*]Tool-validated release: automated tests and packaging pass. Your likeness result in-game still depends on photo quality, installed head mesh/slider packs, and RaceMenu finishing.
[/list]

[size=4][b]Permissions[/b][/size]
[list]
[*]You may use FaceForge to create presets for personal use and for mods you publish, subject to the permissions of any third-party assets [b]you[/b] choose inside RaceMenu / your load order.
[*]Do not reupload this EXE as your own mod.
[*]Do not claim FaceForge “owns” Bethesda assets, RaceMenu, High Poly Head, or any head-part mod it indexes.
[*]Credits for third-party libraries are in the app package / GitHub THIRD_PARTY_NOTICES.
[/list]

[size=4][b]Credits[/b][/size]
[list]
[*]MediaPipe / face landmark stack (local analysis)
[*]Mutagen and related Bethesda-modding libraries (record discovery)
[*]RaceMenu ecosystem authors for the preset / CharGen workflow this tool targets
[*]High Poly Head / EFM authors when those mods are present on the user’s install (not redistributed here)
[/list]

[size=4][b]Source / updates[/b][/size]
GitHub: [url=https://github.com/ShugokiFable/FaceForge]github.com/ShugokiFable/FaceForge[/url]

[size=4][b]Troubleshooting[/b][/size]
[list]
[*][b]App won’t start[/b] — install/update WebView2 Runtime; try running from a folder without exotic permissions.
[*][b]Can’t find Skyrim / CharGen[/b] — confirm Vortex deployment exists; CharGen is usually under your game or RaceMenu folders.
[*][b]Preset flat on a follower[/b] — use 0.23.0+ (live morph filter), bake Export Head after sculpting, and pair with Follower Forge 3.1.1+ which warns on slider-only presets.
[*]When reporting issues, include: FaceForge version, game version, Vortex yes/no, High Poly Head yes/no, and whether the problem is in the app UI or after loading in RaceMenu. [b]Do not[/b] send API keys or full system path dumps with usernames.
[/list]

[size=3][i]This page describes a utility executable. It does not ship Skyrim masters, BSA archives, or other authors’ assets.[/i][/size]
```

---

## Files tab notes (for you, the uploader)

| Field | Value |
|-------|--------|
| Main file name | `FaceForge-0.23.0-STANDALONE.exe` |
| Version | 0.23.0 |
| Category | Main file |
| Software description | Windows x64 utility; WebView2; local MediaPipe; optional user-initiated cloud vision |

## Claims you may make (evidence-backed)

- Tool-validated: frontend tests 70/70, native assertions 92, single-file package SHA matches GitHub release
- Does not write to game Data / Vortex staging by design

## Claims you should not make

- “Perfect likeness every time”
- “Fully tested with every face mod”
- “Safe to update mid-save” (N/A — not an ESP)
- Runtime RaceMenu likeness as guaranteed
