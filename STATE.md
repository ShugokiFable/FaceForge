# FaceForge state

- Active version: `FaceForge 0.21.1` (parent 0.21.0), released
- Implemented: `TriFile` (byte-verified FaceGen `.tri` reader, FaceForge.Core), the `--tri`
  measuring mode on the Core test harness, and the measured `measurementBaselines` -- 32 of 39
  replaced from renders of the four CharGen heads.
- Final EXE: `FaceForge 0.21.1 - STANDALONE.exe` 125926440 bytes
  SHA-256 `2EA7660891E04AE71762539E9AF3FAE14B6E68A7FD6BD0B11FB2A9A44A1FA783`
- Rollback: `FaceForge 0.19.0\artifacts\` (the workspace root carries only the current release; each
  superseded root copy is removed only after confirming its snapshot copy).
- 0.19.1 fixed the race ranking: the eight races were each averaged over their own differing
  proportion sets and those averages then sorted against each other, so Redguard was scored on a
  dimension no rival was tested on. Ranking now uses the three proportions all races estimate, and
  near-ties are labelled instead of ordered.
- Tests: 61 frontend, 82 native. Clean .NET and frontend builds, single-file gate,
  isolated one-file launch.
- The EXE now reports its real version. It had been stamped 0.6.0 since 0.6.0.
- **Next version is 0.21.0.** Snapshot a new folder; do not continue inside 0.20.0.

## Why this version exists

The slider model was estimated. A slider is the deviation of a face from the head it starts on, and
that reference head had never been measured -- so every export carried a constant bias. Feeding the
neutral head itself into 0.18.0 produced 107 non-zero sliders, mean 0.99, several pinned at +3.

The mesh data that makes it measurable was loose on disk the whole time.

## Calibration rig

Reproducible, and it will be needed again for anything that changes what a head measures:

```
python qa/render-head.py --all   "<Data>/meshes" qa/heads   # the four neutral heads
python qa/render-head.py --races "<Data>/meshes" qa/races   # nine race heads x two sexes
vite preview --port 4173                                    # from the web build cache
node qa/calibrate-baselines.mjs                             # universal baselines
node qa/calibrate-races.mjs                                 # per-race factors
```

Convergence is the check: re-running against a build that already carries the calibrated values
reproduces all 32 to the last digit.

## What 0.20.0 did

Measured all nine playable race heads from `<sex>HeadRaces.tri` and replaced the prose-derived race
table, which had described Redguard with a "+8% broad nose" the real morph contradicts by being 3%
narrower. Rebased the universal baselines onto the mean playable head, since 0.19.0 had measured a
head carrying no race morph -- one no player ever sees.

## Planned next

1. **EFM morph response weights** (the original step 3, deferred). Measure each slider's plus/minus
   morph pair from the TRI and replace the estimated response weights, settling the 0.16.0-0.18.0
   High Poly Head gain question. `TriMorph.MaxDisplacement` and `--tri` already report displacement
   at weight 1; missing is the slider-name to morph-pair mapping and a definition of "correct
   response" in slider units.
2. **Poor-pose handling — still entirely open.** 0.21.0's near-half weighting was withdrawn in
   0.21.1 after it inflated mirrored widths up to 2.7x on the very photo it targeted. Before
   retrying: work out why the inflation exceeded what a 0.8/0.2 blend can produce, and build a
   real turned-photograph fixture. The synthetic mesh is symmetric by construction and passed the
   broken change.
3. Then the bounded solve, and sculpt as the residual.

## Known defects, not yet fixed

- **The diagnostic mesh renders as a jagged scribble on some inputs.** Seen on a heavily turned
  portrait (26.8 degree turn, 26% left/right landmark disagreement, only 155 paired points); the
  same panel draws correctly on a clean frontal photo. Cause unknown.
- **A badly posed photo still produces a confident-looking result.** That run scaled widths by 1.120
  to undo the turn, which inflated `jawWidth` to 0.830, and every downstream number inherited it.
  0.21.0 stopped the hidden half from contributing equally, but the warnings still sit beside an
  output that looks as certain as any other.
- **Race names carry real-world coding.** A geometry-only ranking that prints percentages beside
  Redguard, Nord and the elves will be read as an ethnicity claim whatever the code does. 0.19.1's
  tie labelling reduces it; dropping the leaderboard for an unordered set of shape matches would
  end it. Product decision, not a bug fix.

## Open questions

- **Do EFM sliders act on a High Poly Head head on this installation?** The only EFM head morph
  file found is 996-vertex vanilla topology whose base extent matches the vanilla head exactly; the
  HPH chargen TRI (3832 v) carries only the 122 vanilla morphs. User-side test: load an HPH preset
  in RaceMenu and drag one EFM slider. If nothing moves, part of 0.15.0-0.18.0 tunes something
  inert.
- **Seven baselines are still estimates.** Brow height, angle, width and thickness, and iris size,
  because Skyrim draws those as textures rather than geometry and a render cannot judge them.
  `lipGap` because the four heads disagreed by 175% of the mean. They are marked in source, and
  they are where the remaining neutral-head bias lives.
- **How far does the race ranking deserve to be trusted at all?** The nine real morphs sit within
  about 5% of each other, so most photographs will legitimately tie. Each race's own head now
  identifies that race (regression test), but a photograph is not a race head.

## Limits (unchanged)

- No guessed sculpt vertex deltas (D-004). No UBE mapping. F5/F9 warp still future.
- Runtime: tool-validated; RaceMenu likeness remains user-side.
