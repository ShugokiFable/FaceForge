# FaceForge 0.24.2 — Windows tool (not a Skyrim mod)

**This is a Windows application.** It is **not** a Skyrim plugin, not an SKSE DLL, and
**must not** be installed into Skyrim `Data`, Vortex, or Mod Organizer 2 as a game mod.

FaceForge turns a photograph into an **editable RaceMenu starting preset**. You finish
the face in RaceMenu in-game. For a full NPC follower afterward, use **FollowerForge**.

---

## What to download / what you get

| File | What it is |
|------|------------|
| `FaceForge-0.24.2-STANDALONE.exe` | The whole tool (double-click to run) |
| This `README.md` | How to use it |

No .NET install. Needs **Windows 10/11** with **Microsoft Edge WebView2** (usually already installed).

---

## How to install the TOOL (not the game)

1. Unzip this download **anywhere on your PC** (Desktop, Documents, Tools folder, etc.).
2. Double-click **`FaceForge-0.24.2-STANDALONE.exe`**.
3. **Do not** drop the EXE into `Skyrim Special Edition\Data`.
4. **Do not** add this zip as a Vortex/MO2 mod for Skyrim.

FaceForge only **reads** your game/Vortex/CharGen folders. It does not change your load order.

---

## How to use it (short)

1. Run the EXE. Let it find Skyrim and index your setup (read-only).
2. Add a clear front photo (or multi-view / slow turn video).
3. Analyze → pick race/sex → pick installed head parts (hair, eyes, etc.).
4. Export a **RaceMenu preset pack**.
5. In Skyrim: open RaceMenu → load the preset → sculpt if you want → use **Export Head**
   (not “slider-only / no sculpt”) if you will build a follower next.
6. Optional: open **FollowerForge** and build the NPC plugin from that baked head.

---

## Requirements

**Hard**
- Skyrim Special Edition or Anniversary Edition
- RaceMenu (to load/export the preset in-game)
- Windows 10/11 + WebView2

**Optional**
- High Poly Head and any head-part mods you already use
- [FollowerForge](https://github.com/ShugokiFable/FollowerForge) — builds the follower NPC after Export Head

---

## What this is / is not

| It is | It is not |
|-------|-----------|
| An out-of-game Windows utility | A downloadable follower character |
| A photo → RaceMenu preset helper | Something you enable in your load order |
| Safe to keep outside the game folder | A replacement for RaceMenu or Creation Kit |

---

## Pair tool

**FaceForge** (face preset) → RaceMenu bake → **FollowerForge** (NPC plugin).

GitHub: https://github.com/ShugokiFable/FaceForge  
Release: https://github.com/ShugokiFable/FaceForge/releases/tag/v0.24.2