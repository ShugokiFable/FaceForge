# FaceForge decisions

## D-043: The installed slider set is learned from a preset, not assumed

RaceMenu slider names exist only inside the running game — they come from morph packs that
register at load, not from anything FaceForge can enumerate on disk. Guessing which ones a user
has would either under-write (the 0.9.0 behaviour, 35 sliders against an install that offers 206)
or write dead keys into the preset.

So FaceForge reads them from a preset saved on that install. Any preset that touched sliders lists
every one of them, and the supplied `READ_ALL_SLIDERS_TEST.jslot` — saved with all of them
touched — is the ideal form. With no inventory the app writes the EFM family alone, because
Expressive Facegen Morphs is the one family the plugin index can independently confirm.

## D-042: Each slider family has its own range

Measured across the five hand-authored reference presets: EFM spans 148 values with an absolute
maximum of exactly 3.00, while CME, NSK, SPG and RANs together span 132 values with an absolute
maximum of 1.31. EFM runs to ±3; the rest run to about ±1.

A CME value written on the EFM scale would be three times too strong. The generator, the JSlot
writer, and the on-screen slider controls all take the range from the slider's own family.

## D-041: Integer type selectors are never written as morph values

`CME_NoseType`, `CME_EyesType`, `CME_LipType` and `ECE_EarShape` carry indices, not magnitudes —
26, 21, 24 and 6 in the supplied preset. They pick a numbered vanilla shape. Writing one as though
it were a continuous morph would silently swap the feature for whichever shape happens to sit at
that index, and FaceForge cannot know which numbered nose matches a photograph without rendering
them. They are excluded from the catalog and rejected by the writer.

## D-040: Give the model the resolution a tight portrait would have had

The landmark model resizes its input to a fixed internal size, so a face occupying a small part of
a wide shot is landmarked from far fewer pixels than one that fills the frame. The second
detection pass therefore crops to the face as well as straightening it — one canvas operation, no
extra cost over the straightening pass that already existed.

Measured by pasting the QA portrait into a frame three times larger: the reframed run lands within
0.063 worst case and 0.016 mean of the tightly framed run. The combination also improved the tilt
case, from 0.154 worst case to 0.084, because a straightened face is now also a bigger one.

## D-039: A vision delta must be proportionate to the slider range

Refinement deltas were bounded at ±3. Against the old ±10 range that was a third of the scale — a
nudge. Against the ±3 range introduced in 0.7.0 it is the entire scale, so a refinement could
invert the local measurement outright. Refinement is now bounded at ±1.

Interpretation from neutral is the opposite case: local landmarking failed, the model's values are
the whole result, and there is nothing to be conservative about. That path keeps the full ±3. The
bound is carried in one `VisionContext` and drives the prompt text, the JSON schema, and the
response validation together, so the three cannot drift apart.

## D-038: The vision prompt must know which job it is doing

The frontend has always known whether local landmarks succeeded and whether the source is a
photograph or an illustration, and always sent both with the request. The desktop bridge discarded
them, so every request got one prompt that tried to cover all four combinations at once — telling
the model to "return deltas from the local estimate, or from neutral when local landmarks were
unavailable" without saying which had happened.

Both facts now reach the request. The prompt asks for corrections or a full interpretation, never
both, and gives photograph or illustration guidance, never both.

## D-037: Correct recoverable geometry, distrust everything else

An imperfect photograph fails in two different ways and they need two different answers.

Pose is recoverable. Tilt is a plain 2D rotation. A turn or a nod foreshortens one axis by a
cosine. Left/right disagreement is removable by mirror-averaging. All three are undone before
measuring, so the numbers describe the face rather than the camera.

Expression is not recoverable. A smile genuinely widens the mouth; a blink genuinely closes the
eye. One frame does not contain the neutral shape, and FaceForge has no neutral reference of the
same person to solve one from. Inventing a de-expression model would be guessing dressed up as
correction. Instead the affected measurements fade toward the neutral baseline in proportion to
the detected strength, so a grin produces "mouth width unknown, left at default" rather than a
character that grins permanently. The expression weights say which measurement an expression
physically moves and roughly how completely — they are deliberately coarse and labelled as such.

The same fade handles pose that is too extreme to undo. Past 32° of turn or nod the correction
stops and the width-driven or height-driven measurements lose confidence instead, because scaling
by a larger cosine amplifies landmark noise faster than it recovers shape.

## D-036: A tilted image is straightened before landmarking, not after

Landmark detection is not rotation invariant. The same face photographed at a tilt lands its soft
features — brows especially — in measurably different places, and de-rotating the landmarks
afterwards fixes the geometry but not the model's own error. Re-importing the QA portrait at a 16°
tilt drifted `EFM_Brow_Height` by 0.581 with landmark-only de-rotation. Straightening the image
and detecting a second time cut the worst case to 0.154 and the mean across all 35 sliders to
0.029. A control run that re-encoded the same portrait through the same canvas at 0° produced
exactly zero drift, which rules out resampling as the cause.

The second pass is skipped below 4° and falls back to the first pass if the rotation loses the
face. The landmark overlay on the photo keeps the first-pass coordinates, because that is the
image the user is looking at.

## D-035: Mirror-averaging is safe because the output is bilateral

EFM has no per-side sliders. Skyrim cannot represent an asymmetric face from this pipeline, so
measuring one pose-biased side is strictly worse than averaging both. The mesh is mirror-averaged
about its own symmetry axis before measuring.

Pairing the seventeen bilateral measurement landmarks comes from a fixed table rather than being
rediscovered per image. Geometric rediscovery fails exactly on an asymmetric face — the mirror of
a displaced landmark falls outside any safe matching radius — which is the case this whole feature
exists to handle. Contour points that only feed the on-screen diagnostic are still matched by
mutual nearest neighbour, where a mismatch is cosmetic.

## D-034: The user is told what was corrected and what was discarded

Silent correction is indistinguishable from a bug when the result looks wrong. The analysis panel
reports the tilt, turn, and nod that were removed, how many landmark pairs were averaged, and a
named list of every measurement left at the neutral default. Sliders whose measurement was faded
are flagged in the output panel — "neutral" when held entirely, a percentage when partly trusted —
so a held value reads as a known gap the user can fill in by hand, not as a measurement.

## D-033: EFM output is bounded at ±3 and compressed, not clipped

RaceMenu's Expressive Facegen Morphs sliders are bounded at ±3. The evidence is five unrelated,
hand-authored preset mods installed on this machine — Bella, Dua Lipa, Lulu, Maya, Natalya —
carrying 148 EFM entries between them: none outside ±3.00, and four of the five touch exactly
3.00 on some slider. FaceForge 0.6.0 clamped at ±10 and the shipped Homelander package carried
±8.5, which is what produced the "over-exaggerated high elf" result in game.

Range alone is not enough. Those same presets sit at mean |value| 0.48–1.11 with a 90th
percentile of 1.4–2.3, so a normal face must land in that band rather than resting against the
limit. Deviation is therefore passed through `3·tanh(x/3)`: linear for ordinary faces, bending
only near the edge, so an extreme measurement approaches ±3 instead of a whole group of sliders
flattening onto the same maximum.

## D-032: Both brows must be measured in the same screen direction

The left brow was measured landmark 70 → 107 and the right brow 336 → 300, which sweeps the
opposite way across the screen. `atan2` therefore returned an angle near ±180° for the right
brow, and the left-minus-right difference reported roughly 87° of tilt for an almost flat brow.
`EFM_Brow_Angle` was consequently pinned at the maximum on every exported preset. The right brow
is now measured 336 → 300 in the same left-to-right direction as the left.

## D-031: Head-part identity comes from the record, never from its name

An HDPT record states what it is. `Type` gives the category (Hair, Eyes, Eyebrows, FacialHair,
Scars, Face, Misc), `Flags` gives `Male`, `Female`, and `Playable`, and `ValidRaces` points at a
form list of the races that may wear it. FaceForge 0.6.0 read none of them and substring-matched
names instead, which both over-included (any record containing "eye") and under-included (a brow
whose name has no category word). On the installed library, 3,481 of 3,629 records carry a Type
and only 148 still need the name fallback.

Two gates are deliberately permissive. A record with neither gender flag is offered to both
sexes, because Skyrim does not restrict it. A `ValidRaces` list that cannot be resolved against
installed plugins is reported as unknown and stays visible — never treated as "valid for no
race" — so an unparsed plugin hides nothing.

## D-030: The race and sex are chosen from installed RACE records

FaceForge parses the playable RACE records out of the installed base game rather than shipping a
hardcoded list of ten names. The geometry ranking still produces plain-English suggestions, but a
suggestion is only selectable when it matches a real installed record. The chosen race and sex
filter the head-part lists and are written into the export README and manifests, because RaceMenu
silently ignores head parts that are invalid for the active race or sex — which made a correct
selection in FaceForge look broken in game.

## D-029: The follower handoff names only paths RaceMenu writes and Follower Forge reads

The 0.6.0 export manifest told the user to expect `Data/Meshes/CharGen/Exported/<name>.nif` and
`Data/Textures/CharGen/Exported/<name>.dds`. Neither exists. RaceMenu writes the companion head
mesh and tint texture as `Data/SKSE/Plugins/CharGen/<name>.nif` and `.dds` beside
`Presets/<name>.jslot` — the layout used by every preset mod installed here and by all five
supplied reference packs — and Follower Forge's CharGen discovery enumerates NIF files in
`Data/SKSE/Plugins/CharGen`. The follower path could therefore never complete regardless of what
the user did in game.

FaceForge still cannot produce the NIF or DDS itself; only the running game knows the active
race, sex, head parts, TRI topology, and tint layers. What it can do is close the loop, so a
baked-head check now scans the indexed Data folder for the finished trio and adopts it as the
Follower Head Kit source.

## D-028: Skin, body, and overlays are not selectable head parts

FaceForge only offers parsed HDPT records for brows, eyes, and hair. Texture overlays, skin replacers, body replacers, and unrelated follower mods are excluded instead of being presented as facial-part recommendations.

## D-027: A JSlot-only package is a RaceMenu export stage, not a follower

The former New Follower Workflow did not contain FaceGeom NIF, FaceTint DDS, or an NPC plugin. It is now named RaceMenu Head Export and explicitly stops at the JSlot plus exact selection/dependency manifests. RaceMenu must materialize the matching NIF/DDS, after which Follower Forge handles race, voice, class, placement, equipment, spells, perks, behavior, and the NPC plugin.

## D-026: Exact parsed records replace whole-pack guesses

Installed appearance choices come from deployed HDPT records with exact Vortex provenance. The UI exposes the record name, EditorID, `plugin|FormID`, supplying plugin, masters, and missing masters, and the selected `formIdentifier` is written into the JSlot. Shape words are trusted only when they are present in the actual record name; numbered names require visual confirmation in RaceMenu.

## D-025: Multi-view improves confidence without pretending to recover a 3D head

Front, left, and right inputs share the same local MediaPipe analysis. The front view remains authoritative for width-sensitive proportions because perspective compresses them in turned views. Accepted angled views corroborate vertical proportions and raise confidence; blurred, wrongly directed, expressive, or contradictory views are warned and down-weighted. Turn-video capture is a local convenience that selects three useful frames from the same workflow, not a new reconstruction engine.

## D-024: Landmark geometry must use source pixel aspect

MediaPipe returns normalized X and Y coordinates, but X is divided by image width while Y is divided by image height. They cannot be combined as equal units unless the source is square. FaceForge now multiplies every horizontal delta by source width/height before calculating mixed-axis distances or angles. The same correction feeds measurements, pose warnings, symmetry, race ranking, sliders, stylized interpretation, and face-local preview projection.

## D-021: The preview must show interpreted geometry

Raw MediaPipe landmarks are evidence, not the final Skyrim target. For stylized sources, the diagnostic now vertically transforms the landmark mesh to the normalized face aspect that actually feeds race ranking and EFM sliders. Labels, mesh, and generated output therefore describe the same interpretation.

## D-022: Stylized face height needs a stronger bounded correction

The supplied Frieren anime reference produced raw face anchors near 1.78 and remained at 1.619 after the general 62% art blend. The corresponding Skyrim screenshot was also over-read by the same anchors. Face aspect now receives a stronger correction than local features, capped at 92% toward the 1.34 Skyrim-human baseline. Frieren resolves to 1.426 while her jaw, eyes, nose, and mouth measurements remain unchanged.

## D-023: Existing follower FaceGen is calibration evidence, not a preset template

The supplied follower contains an ESP, `00000800.nif` FaceGeom, matching FaceTint DDS, custom ears, and a custom High Poly Head, but no JSlot. FaceForge may use those files read-only to understand the intended appearance; it must not copy third-party FaceGen into a new preset or claim it can recover the original RaceMenu sliders.

## D-001: Photo-first output

FaceForge 0.3.0 creates a valid fresh format-3 `.jslot` without a source preset. Its empty `headParts` list intentionally lets RaceMenu use the active race and sex defaults before applying generated custom morphs. A source `.jslot` is optional inheritance, not a prerequisite.

## D-002: Photo-guided, not photo-identical

A single frontal image cannot recover hidden/profile geometry, camera calibration, skin beneath hair, ears, neck seams, or material maps. FaceForge maps measured landmark proportions into conservative editable EFM sliders and exposes every value for review.

## D-003: Local-first inference

The MediaPipe model and WebAssembly runtime ship with the application. Images remain local by default. Optional provider refinement uploads a prepared portrait only after explicit consent and only when the user presses Refine.

## D-004: No guessed sculpt synthesis

RaceMenu stores sparse per-vertex sculpt deltas, but reliable generation requires a calibrated mapping between MediaPipe landmarks and the exact CharGen host topology. FaceForge does not invent that mapping. Optional inherited sculpts can be preserved or cleared.

## D-005: EFM is the generated-slider dependency

Photo-driven values target 35 exact slider keys found in the installed `Expressive Facegen Morphs SE` `human.ini`. Templates may contain other slider families; FaceForge leaves them unchanged.

## D-006: Windows desktop shell

The editor is React/Vite for testability and a WPF WebView2 host for a normal Windows `.exe`, local selection, environment indexing, native export dialogs, and a one-file public build.

## D-007: Exact deployment provenance

Dependencies are resolved from exact plugin names in `modNames`, legacy `mods`, and `headParts.formIdentifier`. The native index streams Vortex's deployed-file manifest and records the exact winning source mod. It does not use substring matches or arbitrary profile timestamps.

## D-008: Three honest output products

RaceMenu Preset Pack contains the generated JSlot and dependency documentation. New Follower Workflow adds a machine-readable external-export job and exact instructions for producing the matching JSlot/NIF/DDS trio through RaceMenu. Follower Head Kit packages an already existing compatible trio. None is labeled an install-ready follower because final FaceGeom/FaceTint paths and NPC records are plugin/FormID-specific.

## D-009: Hybrid vision, not LLM-only geometry

MediaPipe remains the deterministic local geometry layer. A vision LLM can refine observed proportions but cannot recover exact Skyrim mesh vertices. OpenRouter keys remain in memory, are never written or logged, and requests use strict structured output and privacy-constrained routing.

## D-010: Permission is separate from detection

The index reports which installed mod supplies each dependency and asset. It never implies redistribution permission. Standalone asset copying remains blocked until the user has permission.

## D-011: One public EXE

Version 0.4.0 embeds the web application, MediaPipe runtime/model, .NET runtime, and native libraries in one compressed executable. The embedded bundle is hash-addressed and safely extracted beneath `%LocalAppData%\FaceForge\Web\0.4.0` on first launch. WebView2 Runtime remains the normal Windows prerequisite.

## D-012: Provider-owned subscription authentication

ChatGPT, Claude, and Gemini account access goes through each provider's official CLI. FaceForge launches the provider's own sign-in and never reads OAuth tokens, browser cookies, or chat-web sessions. Provider plan quotas apply; API services remain separate.

## D-013: RaceMenu owns external-head materialization

RaceMenu's own `SaveExternalCharacter` path produces the matching external JSlot, NIF, and FaceTint DDS. The generated preset is loaded on the chosen race/sex first, then RaceMenu materializes the actual head topology and tint output for follower handoff.

## D-014: Do not fake a photo DDS

Changing a rectangular portrait's compression/container to DDS does not convert camera-space pixels into Skyrim's head UV layout. A real optional photo-derived skin system would need a permitted base texture, calibrated mesh-to-landmark projection, profile/seam coverage, occlusion filling, color matching, and proper diffuse/normal/specular treatment. FaceForge 0.4.0 does not mislabel a broken conversion as that feature.

## D-015: Official source beats inherited assumptions

The photo-first design was checked against official RaceMenu source: preset loading resets to active race/sex default head parts, then applies listed compatible replacements and custom morphs. This evidence replaced the earlier template-required assumption.

## D-016: Automatic discovery with bounded evidence

FaceForge checks an explicit override, Windows registry, Steam library manifests, and the default Steam location. It validates candidates by finding `Skyrim.esm` in Data, then uses the deployed `vortex.deployment.json` and its exact staging/target header. It does not broadly scan arbitrary disks.

## D-017: Race means morph foundation, not ethnicity

The app ranks Nord, Imperial, Breton, Redguard, Orc, Dark Elf, High Elf, and Wood Elf from visible landmark geometry only because the installed EFM `races.ini` maps those races to `human.ini`. Skin color and real-world ethnicity are excluded from analysis and prompts. Beast races are not recommended by this human topology model.

## D-018: Stylized sources require interpretation

Anime and illustrated faces are not mapped as raw symmetry. Automatic raster evidence or the user's explicit mode selects a realism-normalization pass that blends exaggerated measurements toward plausible human baselines while retaining relative identity cues. If MediaPipe fails, consent-gated vision may generate conservative controls from neutral.

## D-019: Recommendations require deployed evidence

A mod becomes an appearance candidate only after exact deployed mesh/texture/TRI paths prove the category. Source-mod names may improve ranking only after that evidence exists. Supplying plugins come from the same exact Vortex source, and direct requirements come from TES4 `MAST` headers.

## D-020: Do not invent head-part records

Asset and plugin evidence cannot safely choose a visual brow mesh or unparsed head-part FormID. FaceForge recommends the installed pack and measured visual target, while the user selects the matching head part in RaceMenu. Saved RaceMenu output then carries the real dependency.
