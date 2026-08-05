# FaceForge — Nexus Mods release kit

**Status:** ready to upload  
**Version:** 0.23.1  
**Main file to upload:** `FaceForge-0.23.1-STANDALONE.exe`  
**Size:** 125,958,298 bytes  
**SHA-256:** `933E62EFD5036B47EA4ACFAD880B857EA57415E16BD155EC72E8395E45D248EE`  

**Local path (for you only — do not put on Nexus):**  
`Z:\Backup\!Skyrim AE\!!!SkyrimAEaiWorkspace\FaceForge\FaceForge-0.23.1-STANDALONE.exe`  

**GitHub release:** https://github.com/ShugokiFable/FaceForge/releases/tag/v0.23.1  

Do **not** paste local disk paths, usernames, or API keys on the Nexus page.

---

## Nexus form fields

| Field | Suggested value |
|--------|------------------|
| Mod name | FaceForge |
| Category | Utilities |
| Version | 0.23.1 |
| Tags | Utilities for Players, Character Preset, RaceMenu, tool |
| Language | English |
| Adult content | No (utility; no adult assets shipped) |
| Main file | `FaceForge-0.23.1-STANDALONE.exe` |
| File type | Main File |
| Software type | Utility / tool (executable) |

**Requirements (Nexus requirements list):**
- Skyrim Special Edition / Anniversary Edition (hard)
- RaceMenu (hard, for loading presets)
- Microsoft Edge WebView2 (usually already on Windows 10/11)
- Optional: High Poly Head, EFM, FaceForge-related face mods the user already uses
- Soft recommend: FollowerForge if building an NPC after baking the head

---

## Short summary (mod card — paste as-is)

```
Windows tool that turns a photograph into an editable Skyrim RaceMenu starting preset. Indexes your Vortex/CharGen install read-only, measures faces locally with MediaPipe, and exports real head-part records with plugin requirements. Optional vision refinement only after you consent. Not a finished follower — bake the head in RaceMenu, then use FollowerForge for the NPC plugin.
```

---

## Detailed description (BBCode — paste as-is)

```bbcode
[center][size=5][b]FaceForge[/b][/size]
[i]Photograph → editable Skyrim RaceMenu starting preset[/i]

Local-first Windows app for Skyrim Special Edition / Anniversary Edition.
No installer. One self-contained EXE.
Pairs with [b]FollowerForge[/b] for the NPC plugin after RaceMenu Export Head.
[/center]

[size=4][b]What it is[/b][/size]
FaceForge is an [b]out-of-game Windows utility[/b]. It does [b]not[/b] replace RaceMenu, does not inject into Skyrim, and does not edit your load order.

You give it a face photo (or multi-view photos / a slow turn video). It measures the face locally, ranks geometry-only race foundations from playable races, lets you pick race/sex and installed head parts, then writes a [b]RaceMenu preset pack[/b] (and related export options) you can finish in-game.

Pair it with [b]FollowerForge[/b] if you want an NPC plugin after you bake the head in RaceMenu.

[size=4][b]What you get in 0.23.1[/b][/size]
[list]
[*][b]One-file app[/b] — double-click [font=Courier New]FaceForge-0.23.1-STANDALONE.exe[/font]
[*][b]Read-only[/b] discovery of Skyrim, active Vortex deployment, and CharGen folders
[*][b]Local face analysis[/b] with MediaPipe (detection recovery, pose correction, multi-view support)
[*][b]Measured baselines[/b] from real CharGen / race TRI morphs
[*][b]Live morph filter[/b] — omits RaceMenu sliders the target head mesh cannot move
[*]Exact installed [b]HDPT[/b] search with plugin|FormID and requirement hints
[*]Export: RaceMenu Preset Pack, Head Export stage, or preserved-source FollowerForge Head Kit
[*]Optional vision refinement only after you press Refine and consent
[*][b]0.23.1[/b] — handoff copy says FollowerForge (one word) to match the companion tool
[/list]

[size=4][b]Requirements[/b][/size]
[b]Hard[/b]
[list]
[*]Skyrim SE/AE
[*]RaceMenu
[*]Windows 10/11 with WebView2 (usually preinstalled)
[/list]
[b]Optional[/b]
[list]
[*]High Poly Head and any head-part mods you already use
[*][url=https://github.com/ShugokiFable/FollowerForge]FollowerForge[/url] to build the NPC after Export Head
[/list]

[size=4][b]Typical loop[/b][/size]
[list=1]
[*]Run FaceForge → export RaceMenu preset
[*]In Skyrim: load preset, sculpt if needed, [b]Export Head[/b] (not “sculpt only”)
[*]Open FollowerForge and build the follower plugin from that baked head
[/list]

[size=4][b]Source / releases[/b][/size]
GitHub: [url=https://github.com/ShugokiFable/FaceForge]ShugokiFable/FaceForge[/url]
Release: [url=https://github.com/ShugokiFable/FaceForge/releases/tag/v0.23.1]v0.23.1[/url]
```

---

## Permissions

- Utility tool; no third-party game assets shipped.
- Users own responsibility for any presets they share.

---

## Changelog (Nexus)

```
0.23.1
- Pair branding: FollowerForge (one word) in handoff docs and UI copy
- Same face pipeline as 0.23.0

0.23.0
- Live morph filter and release polish
```

---

## Upload checklist

See `NEXUS-UPLOAD-CHECKLIST.md` in this folder.