# FaceForge 0.23.1

FaceForge is a local-first Windows app that turns a photograph or stylized face illustration into an editable Skyrim RaceMenu starting preset.

## Workflow

1. Start the one-file EXE. FaceForge checks Windows/Steam for Skyrim and automatically indexes the detected Vortex deployment and CharGen folders read-only.
2. Use **Quick photo** for one clear front image, or **Guided multi-view** for front/left/right images. A slow turn video can select those frames automatically.
3. Analyze locally with MediaPipe. A tilted photo is straightened and re-detected, then any residual tilt, head turn, and head nod are measured and corrected out, and left/right differences are mirror-averaged. Detected expressions fade only the measurements they physically move. Weak angle views are ignored instead of distorting the front result, and stylized sources are normalized toward believable Skyrim anatomy.
4. Review the three geometry-only race-foundation suggestions. These rank the eight non-beast races supported by the installed EFM `human.ini`; skin color and real-world ethnicity are never analyzed.
5. Pick the **target race and sex**. The list comes from the playable RACE records parsed out of the installed base game. This is what you must set in RaceMenu before loading the preset, and it gates every head-part list below.
6. Search and select exact installed hair, brow, eye, facial-hair, and scar HDPT records. Only records whose own gender flags and `ValidRaces` list allow the chosen actor are offered. FaceForge shows the record name, EditorID, `plugin|FormID`, Vortex source mod, winning plugin, masters, and missing requirements.
7. Use the default fresh foundation or optionally inherit head parts, tints, and sculpt from a JSlot.
8. Export a RaceMenu Preset Pack, RaceMenu Head Export stage, or preserved-source Follower Head Kit.

If MediaPipe cannot map an anime-style face, connected Codex, Claude, Gemini, or OpenRouter vision can create the 35-slider interpretation from a neutral foundation. The model is explicitly instructed to retain distinctive cues while translating art exaggeration into plausible Skyrim geometry.

## Imperfect sources

A perfectly front-facing, neutral-expression photo is hard to get, so FaceForge separates what it
can fix from what it cannot.

**Corrected, because the geometry is recoverable**

- Head tilt. The image is straightened and detected again, then any residual is rotated out. The
  landmark model is not rotation invariant, so correcting only the landmarks is not enough.
- Head turn and head nod, up to 32Â°, by dividing out the cosine that foreshortened each axis.
- Left/right differences, by mirror-averaging the mesh. EFM sliders are bilateral, so a symmetric
  input is the only thing the output can represent.

**Distrusted, because one frame does not contain the answer**

- Expressions. A smile really does widen the mouth and a blink really does close the eye. The
  measurements an expression moves fade toward the neutral default in proportion to its strength,
  so a grin leaves mouth width unset instead of building a permanently grinning character.
- Pose past 32Â°. The correction stops and the affected widths or heights fade instead of being
  scaled up out of landmark noise.

Everything applied is shown. The analysis panel reports the tilt, turn, and nod removed and names
every measurement left at neutral; affected sliders are flagged `neutral` or with a confidence
percentage so you can set them by hand if you know the shape.

## Checking a finished preset

A preset changes after FaceForge writes it. Pick different eyes, hair or a head mesh in RaceMenu
and the head-part list is rewritten, so the dependency report from export time no longer describes
the file â€” and sharing that stale list gives the recipient a preset that silently falls back to
defaults for everything they lack.

**Check a finished preset** re-reads the file and recomputes what it needs: every head part by
name, category and sex, every plugin those parts come from, whether each is installed here and
which mod supplied it, the slider count by family, sculpt hosts, tint layers, and a share-ready
verdict with named blockers. The inspected preset also becomes the export source, so the Preset
Pack ships the recomputed list.

Head parts from BSA-packed mods and from light (ESL) plugins both resolve: the former by parsing
the part's own plugin on demand, the latter by masking the embedded 0xFE load index off the
identifier RaceMenu wrote.

## Recommendation truth

- Race ranking is a morph/topology starting-point recommendation, not an ethnicity classifier. A suggestion is only selectable when a matching installed RACE record exists.
- Choices are parsed from exact deployed HDPT records. Selecting one writes its verified `formIdentifier` into the JSlot and adds its real requirements.
- What a head part *is* comes from its `Type` subrecord, and who may wear it comes from its `Male`/`Female`/`Playable` flags and its `ValidRaces` form list. None of it is inferred from the record name.
- A record with neither gender flag is offered to both sexes, because Skyrim does not restrict it. A `ValidRaces` list that cannot be resolved against installed plugins is reported as unknown and the record stays visible.
- Record names are used for shape matching only when they contain real descriptors such as wide, thin, straight, or arched. Numeric names are explicitly marked for visual confirmation.
- Skin/body replacers and overlay textures are not mislabeled as selectable head parts.
- Generated values stay inside the Â±3 range RaceMenu's EFM sliders actually accept.
- Vortex staging, Skyrim `Data`, CharGen, installed tools, saves, and profiles are read-only.

## Output truth

- **RaceMenu Preset Pack:** generated `.jslot`, dependency/provenance report, and compatible inherited CharGen companions only when present.
- **RaceMenu Head Export:** photo/art-built `.jslot`, exact selected records, dependency report, and the in-game RaceMenu export job. It is not labeled a follower because it contains no NIF, DDS, or NPC plugin yet.
- **Follower Head Kit:** preserved source JSlot/NIF/DDS plus dependency and handoff manifests. It is not an install-ready follower.

### The follower round trip

FaceForge cannot produce the FaceGen NIF or FaceTint DDS. Only the running game knows the active
race, sex, head parts, TRI topology, tint layers, and installed assets. The loop is:

1. Export the **RaceMenu Head Export** stage and install it.
2. In RaceMenu, set the target race and sex, load the preset, then save it back out under the
   same name with sculpt data present. Skyrim writes
   `Data\SKSE\Plugins\CharGen\<name>.nif` and `.dds` beside `Presets\<name>.jslot`.
3. Back in FaceForge, press **Check Skyrim for a baked head**. Once the trio exists it becomes the
   Follower Head Kit source.
4. FollowerForge enumerates the NIF files in `Data\SKSE\Plugins\CharGen` and builds the NPC
   plugin with race, voice, class, placement, equipment, spells, perks, and behavior.

A conventional follower still requires an NPC plugin and plugin/FormID-bound FaceGeom/FaceTint paths. Multi-view improves proportion confidence, but it does not reconstruct exact mesh vertices or a wrapped head texture.

## Optional vision

Local analysis is the default. Optional account-backed refinement uses the official Codex, Claude Code, or Gemini CLI; OpenRouter API-key mode remains available. FaceForge never reads provider login tokens. Images are uploaded only after one-request consent and only when Refine is pressed. Provider quotas apply.

FaceForge now decides whether that request is a **refinement** or an **interpretation**. A clean
photograph keeps its measured sliders and accepts only bounded corrections. Stylized art, low
source quality, weak pose confidence, severe left/right disagreement, too few paired landmarks,
many held measurements, or several near-limit sliders instead rebuild from a neutral EFM face.
The analysis panel shows the reasons and the button changes to **Interpret face with vision model**.
Local values remain editable either way.

FaceForge does not silently search the web or upload extra reference images. Automatic identity
search is ambiguous, privacy-sensitive, and unnecessary for the core fix; Guided Multi-View and
explicitly chosen source art remain the reliable user-controlled inputs.

## Build

Run `build.ps1`, then `package.ps1`. The result is exactly one shareable file: `FaceForge 0.23.1 - STANDALONE.exe`. The web app, MediaPipe model/runtime, .NET runtime, and native libraries are embedded. Microsoft Edge WebView2 Runtime remains the normal Windows prerequisite.

## Source layout

- `src/FaceForge.Web` â€” local/stylized analysis, race guidance, UI, template engine.
- `src/FaceForge.Core` â€” discovery, Vortex/CharGen/appearance index, plugin-master reader, providers, packaging.
- `src/FaceForge.Desktop` â€” WPF/WebView2 host, automatic startup index, native dialogs.
- `src/FaceForge.Core.Tests` â€” native discovery/index/dependency/package validation.
- `qa` â€” browser workflow, screenshots, exported test preset, and fidelity ledger.
