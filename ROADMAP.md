# FaceForge roadmap

Written 2026-07-30 against FaceForge 0.9.0; updated for 0.11.0. Every feasibility claim below is tagged with the
evidence behind it. Nothing here is scheduled; it is a menu.

## The headline question: can FaceForge sculpt the head itself?

**Yes, and the file format is not the obstacle.** The five installed reference preset mods were
parsed directly and the sculpt block decodes cleanly:

```json
"morphs": {
  "sculptDivisor": 10000,
  "sculpt": [
    { "host": "KL\\High Poly Head\\FemaleHeadCharGen.tri", "vertices": 3832,
      "data": [[2157, -217, 667, -143], [1145, 0, 1, 0], ...] }
  ]
}
```

Each `data` entry is `[vertexIndex, dx, dy, dz]` in integers divided by `sculptDivisor`, and the
list is **sparse** — Dua Lipa's head carries 285 of 3,832 vertices, Bella's 1,039, Lulu's 3,808.
Observed hosts and their vertex counts on this installation:

| Host TRI | Vertices |
| --- | --- |
| `KL\High Poly Head\FemaleHeadCharGen.tri` | 3,832 |
| `Actors\Character\Character Assets\FemaleHeadCharGen.tri` (vanilla) | 996 |
| `KL\High Poly Head\FaceParts\FemaleHeadBrowsCharGen.tri` | 371 |
| `Actors\Character\Character Assets\EyesFemaleChargen.tri` | 176 |
| `Actors\Character\Character Assets\Mouth\MouthHumanFChargen.tri` | 141 |

This matters because sculpt is what makes the reference presets look like real people. All five
carry it; FaceForge currently writes none. The 35 EFM sliders are a coarse shape family — sculpt
is the actual likeness.

### Update: there is a better route than writing sculpt deltas

Your Sculpt tab screenshot shows `F5 Export Head` and `F9 Import Head`. That changes the plan
substantially, because it means RaceMenu will hand FaceForge the *finished head mesh* and take a
modified one back — no need to compute deltas against a base mesh FaceForge has to reconstruct.

```text
RaceMenu F5  ->  head mesh on disk
                 FaceForge warps it toward the photo
RaceMenu F9  <-  modified mesh, applied as sculpt
```

Why this is the better path:

- **The base is given, not derived.** Problem 1 below disappears entirely; the exported head already
  has the right topology, the right head mod, and the user's current sliders baked in.
- **It composes with sliders.** The warp starts from the head the 108 sliders already produced, so
  it only has to carry the residual — the part sliders cannot express. Smaller deformation, less
  risk of a mangled result.
- **It is reversible.** `V Clear Sculpt` undoes it in-game, and the jslot never has to be touched.
- **No sculpt-delta encoding at all.** The `[vertexIndex, dx, dy, dz]` format documented above stops
  being something FaceForge must write correctly.

The remaining work is the landmark-to-vertex correspondence and the warp itself, plus reading and
writing the head file format. That is still the largest item on this list, but it is meaningfully
smaller and much safer than the delta-writing plan.

**What stands between here and there (original delta-writing plan)**

1. **Base vertex positions.** Deltas are offsets from the CharGen head mesh, so FaceForge needs to
   read the head NIF (and know which one the chosen race/sex/head mod uses). NIF parsing is a real
   but well-trodden job; Follower Forge already has a `NifHeadFile` reader to learn from.
2. **A landmark-to-vertex correspondence.** MediaPipe's 468-point canonical topology is not
   Skyrim's. Someone has to define, once, roughly 40–70 anchor pairs (nose tip, mouth corners,
   chin, jaw hinge, brow ridge…). This is the genuinely new work and it has to be done by eye.
3. **A deformation.** With anchors in place, a thin-plate-spline or RBF warp carries the whole
   vertex set. Standard technique, maybe 150 lines.
4. **Guard rails.** A bad warp produces a mangled head rather than an obviously wrong number, so
   this needs a per-vertex displacement cap, a self-intersection check, and a visual diff against
   the base mesh before anything is written.

**Important scope note.** Sculpt in a preset works immediately for a *player* character — RaceMenu
applies it on load, no game-side bake required. A *follower* still needs the in-game NIF/DDS bake,
because that is a render of the finished head, not a description of it. So sculpting would make
the player-preset path dramatically better and leave the follower round trip exactly as it is.

**Honest assessment:** the largest single feature on this list, and the one with the highest payoff
for likeness. It is not a weekend job and it should not be attempted without the guard rails.

---

## Scanning and measurement

| # | Feature | Value | Feasibility |
| --- | --- | --- | --- |
| 1 | **Calibrate the baselines against a real neutral head.** Render or screenshot the vanilla and High Poly Head CharGen heads at all-zero sliders, measure them with the same pipeline, and use those as `measurementBaselines`. | **Highest value per unit of work on this list.** The baselines are currently invented numbers; they are the single biggest remaining source of systematic error, and every slider inherits it. | Straightforward. Needs one screenshot per head/sex, or a NIF-based measurement once (1) above exists. |
| 2 | **Multi-photo consensus.** Accept N photos of the same person and take a per-measurement median instead of one frame's value. | High. Random landmark noise averages out; disagreement between photos is itself a useful confidence signal. | Moderate. The multi-view plumbing already exists; this is a different fusion rule plus UI for an arbitrary number of inputs. |
| 3 | **Use MediaPipe's `facialTransformationMatrixes`.** Already enabled in the detector options and completely unused; it is a proper 4×4 head-pose matrix. | Medium. Would replace the depth-derived yaw/pitch estimate with the model's own. | Easy to write, but the column/row-major convention needs empirical confirmation before it can be trusted over the current estimate. |
| 4 | **Per-measurement confidence from landmark jitter.** Run detection on two slightly different scalings and treat disagreement per landmark as noise. | Medium. Turns the trust score from "what did the expression do" into "how repeatable is this measurement". | Moderate. Doubles detection cost. |
| 5 | **A 3D morphable-model fit (FLAME / 3DDFA_V2 via ONNX).** Replaces 468 2D-ish landmarks with a fitted 3D head. | Very high — and it is the natural upstream of the sculpting feature above, since it produces exactly the dense 3D surface a warp wants. | Large. Adds an ONNX runtime and a model file to a currently self-contained app, and needs licence review. |
| 6 | **Profile-photo depth.** Use a true side view to measure nose projection, chin projection, and brow ridge — the depth sliders no front photo can see. | High; `EFM_Nose_Tip_Depth`, `EFM_Chin_Depth`, `EFM_Jaw_Depth` and friends are currently never written at all. | Moderate. Guided multi-view already collects the side images. |

## Output and fidelity

| # | Feature | Value | Feasibility |
| --- | --- | --- | --- |
| 7 | **~~Write the remaining EFM sliders.~~ Shipped in 0.10.0** (35 → 63). Missing families include depth (`_Depth`), eyelids, tubercles, teeth, and eyeball shape. | High. Several are measurable from the front (eyelid heights, lip tubercles); others need the profile view from (6). | Easy per slider once a measurement exists for it. |
| 8 | **~~Support CME / NSK / SPG slider families.~~ Shipped in 0.10.0** via the slider inventory; 108 sliders on this install. | — | Done. |
| 8b | **Suggest eyes, hair and brows by appearance, and propose hair colour and tint from the photo.** Reported as the manual work still left after a good conversion: the sliders were fair, but eyes, hair, colour and the nose base all had to be set by hand. | **Highest remaining usability item.** Head-part gating fixed *which* records are valid; this is about which one to pick. | Hair colour and skin tint are easy (sample the photo). Picking the right brow or eye *shape* needs mesh or texture previews — see (13). |
| 9 | **Skin tone and tint suggestion.** Propose `tintInfo` layers and `actor.headTexture` from the photo. | Medium-high; a correct face shape with the wrong complexion still reads as the wrong person. | Moderate, and needs care: this is the one place the app would start inferring something close to ethnicity. Should be presented as a swatch the user picks, never auto-applied. |
| 10 | **Hair colour suggestion.** Sample the hair region and propose `actor.hairColor`. | Medium. Cheap and uncontroversial. | Easy. |
| 10b | **~~Read an edited preset back and recompute its requirements.~~ Shipped in 0.11.0.** | — | Done. |
| 11 | **Preset diffing.** Load two JSlots and show what differs. | Medium for iteration; you could compare your export against Dua Lipa's and see exactly where they diverge. | Easy — the parser already exists. |
| 12 | **Import an existing preset as the starting point and re-target it.** | Medium. | Easy; `parseRaceMenuTemplate` already reads them. |

## Head parts and environment

| # | Feature | Value | Feasibility |
| --- | --- | --- | --- |
| 13 | **Thumbnail the head-part meshes.** Render each candidate brow/eye/hair NIF to a small preview so the list stops being 3,629 names. | **Very high usability.** The gating fixed *which* records are valid; this fixes *which one looks right*. | Large — needs a NIF renderer. A cheaper 80% version: show the diffuse texture from the record's TextureSet, which is often enough to tell brow shapes apart. |
| 14 | **Detect High Poly Head and pick the matching sculpt host / head part automatically.** | High once sculpting exists; the host path differs between vanilla and HPH. | Easy — the deployment index already sees the HPH asset paths. |
| 15 | **Warn when a selected head part's plugin is missing a master.** Already parsed and displayed; make it block export instead of only informing. | Medium. | Easy. |
| 16 | **Suggest head parts by shape rather than name.** Cluster brow meshes by measured arch/thickness and match to the photo target. | High, and it is what the "Photo target: wide, strongly angled" line currently promises but cannot deliver. | Large; needs (13)'s mesh reading. |

## Workflow

| # | Feature | Value | Feasibility |
| --- | --- | --- | --- |
| 17 | **Batch mode.** A folder of photos to a folder of presets. | Medium; useful for populating a follower roster. | Easy. |
| 18 | **Direct install to the CharGen presets folder** instead of exporting a ZIP the user then installs. | Medium convenience, and it would close the round trip in one click. | Easy, but it writes into the game Data folder, which the project has deliberately kept read-only. Should be opt-in and explicit. |
| 19 | **Watch the CharGen folder** and notice the baked head appearing instead of making the user press "Check". | Low-medium polish. | Easy. |
| 20 | **Undo / preset history** within a session. | Medium. | Easy. |
| 21 | **Side-by-side preview:** the source photo next to a render of the resulting head. | Very high — it is the only way to judge likeness before entering the game. | Large; needs the same renderer as (13). |

## Suggested order

1. **(1) Baseline calibration** — cheapest large accuracy win, and it makes every later feature more honest.
2. **(7) The missing front-measurable sliders** — more of the face described, no new machinery.
3. **(10) Hair colour** and **(11) preset diffing** — small, immediately useful.
4. **(13) Head-part texture previews** — the biggest usability gap now that gating works.
5. **(6) Profile depth** and **(2) multi-photo consensus** — better input, existing plumbing.
6. **Sculpting**, with (5) as its upstream if the ONNX dependency is acceptable.
