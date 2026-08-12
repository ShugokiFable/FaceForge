# Decisions

## 0.24.2 - a filter that excludes everything is not a safe default (2026-08-12)

- **Stacked privacy filters can be a total outage.** Each OpenRouter routing clause narrows the
  provider pool, so `zdr` + `data_collection` + `require_parameters` intersect rather than
  degrade. The intersection was empty for every model in the catalogue, and an empty pool comes
  back as HTTP 404 -- indistinguishable, from the user's side, from a wrong model name. Three
  individually defensible requirements produced a feature that had never worked for anyone.
  Keep the one clause that carries the actual privacy requirement; treat the rest as preferences.
- **A guessed error message sends people to debug the wrong thing.** The old failure text named
  the model, the key and the credits. All three were fine in every report. Repeating what the
  upstream service said costs nothing and would have located this in one comment instead of a
  release cycle.
- **Relaxing a strictness flag means widening the parser.** Dropping `require_parameters` allows
  providers that ignore `response_format`, so the reply may be fenced or prefaced with prose.
  The lenient extractor is part of the fix, not a nicety.
- **`overflow: hidden` plus a pixel `min-height` is a trap, not a layout.** Either alone is fine.
  Together they guarantee that some display size has content it cannot reach, and the failure is
  invisible to whoever authored it on a large monitor.
- **A tool that reads a mod setup should say it is a tool.** Running FaceForge through MO2 is a
  reasonable thing for a Skyrim user to try, and the resulting WebView2 error explains nothing.
  Detecting the wrong-environment case and naming it is cheaper than supporting it.
- **Writing into exactly one slider family is a dependency, and an undeclared one is a silent
  no-op.** 0.24.0's one-measurement-per-family rule is correct, but it makes Expressive Facegen
  Morphs load-bearing: without it RaceMenu imports the preset, reports success, and applies
  nothing. Every report of "it looks generic in game" is consistent with this, and the app said
  nothing. A dependency that can fail silently has to be checked in the UI.
- **Do not tune a number because of a complaint.** Slider gain was the obvious suspect for
  "looks nothing close like it in game". It measures as reasonable -- 0.18 gain against
  sensitivities of 14-38 lands inside the band hand-authored presets occupy -- so it was left
  alone. One report still describes a generic result with EFM present; that stays open rather
  than being papered over with a gain change that would have no evidence behind it.

## 0.24.1 - a rejected measurement is not the same as an unmeasurable one (2026-08-06)

- **Check whether the data already exists before capping a guess.** 0.24.0 bounded five estimated
  baselines. Three had rendered measurements sitting in `qa/race-calibration.json` since 0.20.0,
  passing 0.19.0's own acceptance rule at 4.0%, 8.5% and 24.3% disagreement. The cap was the right
  instinct applied one layer too late; the guesses were 40%, 63% and 30% low and did not need to
  exist.
- **A true premise can carry a false conclusion.** 0.19.0 was correct that Skyrim paints brows and
  irises on as textures and that the neutral head has no brow geometry. It concluded the detector's
  brow landmarks were unusable. But a measurement reproduced to within 4% across twenty rendered
  heads is not noise from a missing feature -- it is what this pipeline measures, on both sides of
  the comparison, which is the exact condition the same file cites as making a rendered baseline
  valid. The rule was written down and then not applied to these five.
- **A centred estimate beats a cornered one.** irisSize and lipGap still fail the disagreement rule
  and stay capped, but their old values sat at the extremes of the observed range. 0.115 against a
  0.0707-0.1177 iris spread biased every single face toward a smaller iris; a large-irised source
  exported -0.63, the wrong direction. Moving an unavoidable estimate to the measured median costs
  nothing and removes a systematic bias.
- **A fixed-topology landmark model always answers, including about things it cannot see.**
  MediaPipe returns brow points for a brow behind a fringe and reports normal confidence. Trust has
  to come from outside the model. Comparing forehead pixels to cheek pixels is crude next to the
  mesh, and it is the only part of the pipeline that can tell whether there was a brow there at all.
- **Read a corroborating signal the right way round.** The first version of the occlusion vote asked
  whether the brow differed from skin. A real brow always does, so the vote was worth nothing and
  scored a shadow identically to a fringe. The discriminating question is whether the brow and the
  forehead are the same material.
- **Make a false UI string as serious as a false value.** Two lines had been wrong for six releases:
  an HPH calibration withdrawn in 0.18.0 that the footer still advertised, and "left at the neutral
  default" printed beside sliders that were not at neutral. Neither changed an exported number and
  both changed what the user believed the numbers meant. Sliders now carry `estimated` and `atLimit`
  flags so a limiter-determined value cannot be read as a measurement.

## 0.24.0 - one measurement writes one family, and a guess does not get a vote (2026-08-06)

- **Slider families are additive, not alternative.** EFM, CME, NSK and SPG are separate mods that
  register separate morph targets, and RaceMenu sums every registered morph onto the head. Writing
  one measurement into several families applies the same displacement two to four times. Confirmed
  on this install rather than assumed: `Expressive Facegen Morphs.esl\sliders\human.ini` maps
  `EFM_Jaw_Width` to `EFM_Jaw_Narrow`/`EFM_Jaw_Wide`, and the vanilla `FemaleHeadChargen.tri` behind
  RaceMenu's own `CME_JawWidth` carries `JawNarrow`/`JawWide` with no `EFM_`-prefixed morph anywhere
  in it. FaceForge now writes the highest-priority family the install offers and the head can move,
  and only that one.
- **The collapse is across families, never inside one.** `EFM_Nose_Width`, `EFM_Nose_Wing_Width` and
  `EFM_Nose_Wing_Thickness` are three pieces of anatomy an author moves together. Removing two of
  them would repeat the 0.23.0 mistake -- dropping working sliders on a theory -- in a new costume.
- **A more capable-looking export was the bug.** Loading a slider inventory reported "writes 108 of
  the 108 sliders it can measure" and read as FaceForge using more of the install. It was writing
  the same face four times. Slider count is not a quality metric, and the UI now says so when the
  written count falls below the matched count.
- **A baseline is a divisor, so a guessed baseline is a multiplier.** Every *measured* baseline put
  the reported face inside 10% of neutral; every *guessed* one threw it to the end of the range
  (brow thickness +168% against a guessed 0.03). The saturation curve hid it -- 2.93 of 3.00 looks
  like a strong reading rather than a raw 6.66 folded over.
- **The fix is less authority, not a better guess.** 0.19.0 was right that these five cannot be
  calibrated against a render: Skyrim paints brows and irises on as textures, so the neutral head
  has no brow geometry, and calibrating against the landmarks the detector returns anyway would
  trade a guess for a confidently wrong number. That reasoning was sound and the estimates stayed.
  What was missed is that an estimate was still handed a measurement's full range. `browHeight`,
  `browWidth`, `browThickness`, `irisSize` and `lipGap` now keep direction and ordering and cap at
  30% of family range. `browAngle` divides degrees instead of a baseline and is excluded, because
  the defect is specific to the ratio path.
- **Superseded is not inert.** Two different reasons a slider goes unwritten -- "this head cannot
  move it" and "another family already carries it" -- are reported separately. Collapsing them
  would make the next slider-count drop unreadable, which is exactly what made 0.23.0 hard to spot.

## 0.23.0 - a registered slider is not a working slider (2026-08-05)

- **Liveness is proven from geometry, not from the plugin list.** A RaceMenu slider appears
  whenever some `races.ini` registers it and moves the face only when its morph pair exists in a
  `.tri` matching the worn mesh's vertex count. Those conditions are independent. FaceForge checked
  the first, via a slider inventory read from a user preset -- and a preset lists every registered
  slider whether or not it does anything. Measured here: 51 EFM sliders are live on the vanilla
  head and inert on High Poly Head, because Expressive Facegen Morphs registers its extension
  against the vanilla path and ships 996-vertex morphs while the HPH head is 3832.
- **Vertex count is the check the engine cannot fudge.** A morph is a flat per-vertex delta array,
  so a count mismatch cannot be applied under any interpretation. That makes it a decidable test
  offline, unlike anything inferred from mod names or plugin presence.
- **Inspect every part, not just the head.** A slider is applied to whichever mesh carries its
  morph. Checking the head alone marked every eye, brow, and mouth slider inert. High Poly Head
  replaces the head and brows but leaves eyes and mouth vanilla, which is exactly why the EFM
  sliders that still work on HPH are the eye and mouth ones.
- **The gate only ever subtracts.** The registry reads loose files, so a slider ini inside a BSA is
  invisible to it -- ECE Sliders for Racemenu ships exactly that way. A slider the registry has
  never heard of keeps whatever the inventory decided. Treating "not found" as "inert" would
  silently delete working sliders, a worse failure than the one being fixed, so absence of evidence
  is not evidence of absence here and a test pins it.
- **Drop inert sliders, but say so.** Writing dead keys is dishonest output; silently removing a
  third of the face is a different dishonesty. The analysis notice reports the count and the reason.
- **Export Head bakes shape into vertices; the jslot does not carry it.** Fitting an exported head
  against the 122-morph vanilla set leaves 58.6% unexplained for a FaceForge preset and 57.9% for a
  hand-made sculpted one. Two heads built by different routes keep the same proportion of
  non-vanilla shape, so the exported NIF is the vertex-space representation -- not the preset.
  The fit must be pair-bounded: unconstrained least squares puts +6978 on `CheeksUp` against -6976
  on `CheeksDown` and explains anything asked of it.
- **What FaceForge does not write cannot be FaceForge's bug.** It emits no `tintInfo` and no
  head-part `type` ordinal, so the skin tone and type ordinals reported in a generated preset are
  inherited from the foundation the user loaded. Checked before changing anything.

## 0.22.0 - a detected mesh is not automatically a trustworthy measurement (2026-08-01)

- **Vision mode follows reliability, not detector success.** MediaPipe can return every landmark
  for stylized art or a badly turned face while the resulting proportions are still implausible.
  Stylized sources and analyses with poor quality, weak axis confidence, severe left/right
  disagreement, too few paired landmarks, many held measurements, or several near-limit EFM
  values therefore request a full interpretation from neutral.
- **One mode owns prompt, range, and baseline.** Refinement is a +/-1 delta applied to trustworthy
  local values. Interpretation is a +/-3 absolute result applied to neutral. Carrying one explicit
  mode through the frontend and desktop bridge prevents the prompt and result application from
  disagreeing again.
- **Do not silently search or upload.** Character-name lookup can choose the wrong design, and face
  uploads are privacy-sensitive. Vision remains explicit and consent-gated; the user controls the
  source images.

## 0.20.0 - the game states what a race head is; do not describe it in prose (2026-07-31)

- **Never estimate something the game files state exactly.** The race table was written from
  descriptions in 0.12.0 and marked "approximate". It was not approximate, it was wrong in the
  opposite direction: Redguard was given a +8% nose where the real morph is 3% narrower. The morphs
  were in `<sex>HeadRaces.tri` the entire time. "Approximate until measured" is only acceptable when
  measuring is genuinely unavailable, and it should carry a note saying where the real data lives.
- **Prose about a race is where stereotype enters.** "Strong cheek and jaw geometry, moderately
  broad nose foundation" is not a measurement, and for a race coded to a real-world people it
  reproduces a caricature and then ranks faces against it. Descriptions are now generated from the
  measured factors, so the shipped text cannot say anything the mesh does not.
- **The reference head must be one that exists.** 0.19.0 calibrated against the CharGen mesh with no
  race morph applied. Every character carries one, so that head is never seen in game; the average
  real head is 5.4% longer in the face than it. Rebased onto the mean playable head.
- **A ranking's honest output can be "these are the same".** The nine real morphs sit within about
  5% of each other. Reporting many near-ties is the correct answer, not a defect to tune away.
- **Test the identity case.** Each race's own head must make the ranking name that race. The
  fabricated table could not have passed it, and nothing in the suite asked.

## 0.19.0 - measure the head by rendering it, not by reading it (2026-07-31)

- **Calibrate through the app's own pipeline, not from mesh geometry.** Measuring vertex distances
  directly would produce numbers in a different arithmetic from the photo side, so every bias in the
  measurement code would land on one side of the comparison only. Rendering the head and running the
  real detector and the real measurement code over it makes those biases cancel.
- **The `.tri` is the source of truth for the head, not the NIF.** The base vertices sculpt indexes
  into live in the CharGen `.tri` the preset already names as its host, so no NIF parsing is
  involved. The roadmap's first sculpt blocker did not exist.
- **Full detector confidence is not evidence the right feature was measured.** Skyrim draws brows
  and irises as textures, so a render has neither, yet MediaPipe returns brow and iris landmarks at
  full confidence by placing them on the brow ridge and the eyeball. Those five baselines stay
  estimated and marked. Trading a guess for a confidently wrong number is worse than the guess.
- **Recover contaminated measurements instead of discarding them.** The trust fade is exactly
  `baseline + (measured - baseline) * trust`, so inverting it returns what the detector saw. Below a
  third of trust the division amplifies noise more than it recovers signal, so it is dropped.
- **Convergence is the acceptance test.** Re-running the calibration against a build that already
  carries the values must reproduce them exactly, or the recovery is just echoing the baseline it
  started from.
- **Per-race baselines become multipliers, not absolute proportions.** They only ever knew how a
  race differs from the average. Held as absolutes on the old scale, they would have overridden the
  measured table and made choosing a race worse than choosing none.
- **Ship the calibration rig, not just its output.** `qa/render-head.py` and
  `qa/calibrate-baselines.mjs` stay in the snapshot with the renders and the full JSON, because the
  numbers are only trustworthy if they can be reproduced and re-derived when a head mod changes.

## 0.14.0 - geometry style bridge, not ethnicity converter (2026-07-31)

- **Reject "real races → Skyrim races" as ethnicity detection.** Photos are never classified by
  ancestry or skin color. That would be wrong technically (landmarks have no ethnicity signal
  FaceForge trusts) and wrong product-wise.
- **Accept optional geometry styles.** Hand-authored presets that target a compact soft midface
  leave a transferable EFM signature (narrow bridge/cheeks, softer jaw, larger eyes) and usually
  sit on Breton/Wood Elf/Imperial. FaceForge can score that silhouette and nudge baselines.
- **YUYOU is evidence; Hitomi is not.** YUYOU uses EFM+HPH+sculpt. Hitomi is UBE morph alphabet
  with no EFM — mapping it would invent a foreign slider dialect.
- **Sculpt stays out.** Both examples rely on sculpt or external heads for the final look;
  FaceForge still only writes sliders until the F5/F9 warp path exists.
- **Default off.** Photo fidelity remains the default export.
## 0.13.0 - optional sex proportion touch-up (2026-07-30)

- **Default off.** Sex is already a RaceMenu head-part filter; forcing dimorphism into every export
  would bias photo likeness. The toggle is a deliberate touch-up.
- **Slight multipliers only (~2-4%).** Enough to read firmer male / softer female without looking
  like a different person. Applied as baseline multipliers so the photo still drives the result.
- **Not measured mesh data.** Same honesty as race targets: stylistic until CharGen male/female
  heads are measured.
## 0.12.0 - detection ladder and race-relative baselines (2026-07-30)

- **Detection failures are higher priority than perfect slider calibration.** Prefer an escalating
  recovery ladder over raising the default threshold globally, so clean portraits stay cheap.
- **Multi-face photos pick a subject instead of failing.** Largest face with a centre bias matches
  how people photograph (subject + background poster / crowd).
- **Race targets become slider baselines once a race is chosen.** Ranking-only use left sliders
  floating on a universal average that no Skyrim race actually starts from. Values remain estimates
  until CharGen head meshes can be measured; the structure is correct even when numbers are approximate.
- **Changing race regenerates sliders from cached analysis.** Re-running MediaPipe is unnecessary
  and would make race comparison feel broken.

# FaceForge decisions

## D-046: A baseline is geometry, a gain is strength — never the same knob

A baseline states what the *reference head* measures. A gain states how hard FaceForge pushes a
slider. 0.16.0/0.17.0 used baseline multipliers to make sliders stronger on High Poly Head, which
the code said plainly: "Factor < 1.0 lowers baseline → stronger slider for the same measurement".

That breaks the invariant the pipeline rests on. **A face whose measurements already equal the
reference head must export zeros**, because it has no deviation to encode. With those factors a
perfectly neutral face exported 27 non-zero sliders peaking at 0.55 on the HPH path alone, 34
peaking at 1.53 once race, sex and style stacked — and every real face carried that bias on top of
its real deviation.

The distinction is testable and now tested: a neutral face must produce zeros on every automatic
path. Anything that legitimately shifts a neutral face — the per-race baselines — does so because
it is a real claim about a different reference head, not a strength preference.

## D-045: Head mesh selection does not rescale measurement

The HPH gain rise rested on "HPH needs more EFM travel for the same landmark delta — denser mesh,
authors sit higher in the ±3 band". Neither half holds.

Vertex density does not change morph semantics: an EFM slider's effect is defined by the TRI morph
it drives, and High Poly Head ships its own EFM-compatible morphs. Nothing measured shows a given
EFM value moving an HPH head less than a vanilla one — the claim was inferred from author *output*.

And author values are not photo measurements. Hand-authored presets sit high in the band because
authors stylize deliberately. Matching their mean by raising gain makes FaceForge reproduce
authorial exaggeration, which is a different goal from measuring a face.

If the HPH head genuinely has different proportions, that belongs in the baseline as *measured*
geometry (roadmap item 1) — and then a neutral HPH face legitimately exports non-zero values,
because it really does differ from the vanilla reference.

## D-044: The race recommendation is ranked by the correction it implies

Every playable race starts from a different vanilla head, so a slider is an offset from *that*
head, and the best foundation is the one already closest to the photograph.

Ranking previously scored an abstract distance using per-measurement tolerance constants with no
relationship to the exported values, so the ranking and the sliders could disagree — a race could
be recommended and then produce large corrections. Ranking now runs the real generator against
each candidate and measures the mean absolute slider value over the proportions that race defines.
The recommendation is therefore a statement about the output, and the two cannot drift apart.

## D-043: The installed slider set is learned from a preset, not assumed

RaceMenu slider names exist only inside the running game â€” they come from morph packs that
register at load, not from anything FaceForge can enumerate on disk. Guessing which ones a user
has would either under-write (the 0.9.0 behaviour, 35 sliders against an install that offers 206)
or write dead keys into the preset.

So FaceForge reads them from a preset saved on that install. Any preset that touched sliders lists
every one of them, and the supplied `READ_ALL_SLIDERS_TEST.jslot` â€” saved with all of them
touched â€” is the ideal form. With no inventory the app writes the EFM family alone, because
Expressive Facegen Morphs is the one family the plugin index can independently confirm.

## D-042: Each slider family has its own range

Measured across the five hand-authored reference presets: EFM spans 148 values with an absolute
maximum of exactly 3.00, while CME, NSK, SPG and RANs together span 132 values with an absolute
maximum of 1.31. EFM runs to Â±3; the rest run to about Â±1.

A CME value written on the EFM scale would be three times too strong. The generator, the JSlot
writer, and the on-screen slider controls all take the range from the slider's own family.

## D-041: Integer type selectors are never written as morph values

`CME_NoseType`, `CME_EyesType`, `CME_LipType` and `ECE_EarShape` carry indices, not magnitudes â€”
26, 21, 24 and 6 in the supplied preset. They pick a numbered vanilla shape. Writing one as though
it were a continuous morph would silently swap the feature for whichever shape happens to sit at
that index, and FaceForge cannot know which numbered nose matches a photograph without rendering
them. They are excluded from the catalog and rejected by the writer.

## D-040: Give the model the resolution a tight portrait would have had

The landmark model resizes its input to a fixed internal size, so a face occupying a small part of
a wide shot is landmarked from far fewer pixels than one that fills the frame. The second
detection pass therefore crops to the face as well as straightening it â€” one canvas operation, no
extra cost over the straightening pass that already existed.

Measured by pasting the QA portrait into a frame three times larger: the reframed run lands within
0.063 worst case and 0.016 mean of the tightly framed run. The combination also improved the tilt
case, from 0.154 worst case to 0.084, because a straightened face is now also a bigger one.

## D-039: A vision delta must be proportionate to the slider range

Refinement deltas were bounded at Â±3. Against the old Â±10 range that was a third of the scale â€” a
nudge. Against the Â±3 range introduced in 0.7.0 it is the entire scale, so a refinement could
invert the local measurement outright. Refinement is now bounded at Â±1.

Interpretation from neutral is the opposite case: local landmarking failed, the model's values are
the whole result, and there is nothing to be conservative about. That path keeps the full Â±3. The
bound is carried in one `VisionContext` and drives the prompt text, the JSON schema, and the
response validation together, so the three cannot drift apart.

## D-038: The vision prompt must know which job it is doing

The frontend has always known whether local landmarks succeeded and whether the source is a
photograph or an illustration, and always sent both with the request. The desktop bridge discarded
them, so every request got one prompt that tried to cover all four combinations at once â€” telling
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
physically moves and roughly how completely â€” they are deliberately coarse and labelled as such.

The same fade handles pose that is too extreme to undo. Past 32Â° of turn or nod the correction
stops and the width-driven or height-driven measurements lose confidence instead, because scaling
by a larger cosine amplifies landmark noise faster than it recovers shape.

## D-036: A tilted image is straightened before landmarking, not after

Landmark detection is not rotation invariant. The same face photographed at a tilt lands its soft
features â€” brows especially â€” in measurably different places, and de-rotating the landmarks
afterwards fixes the geometry but not the model's own error. Re-importing the QA portrait at a 16Â°
tilt drifted `EFM_Brow_Height` by 0.581 with landmark-only de-rotation. Straightening the image
and detecting a second time cut the worst case to 0.154 and the mean across all 35 sliders to
0.029. A control run that re-encoded the same portrait through the same canvas at 0Â° produced
exactly zero drift, which rules out resampling as the cause.

The second pass is skipped below 4Â° and falls back to the first pass if the rotation loses the
face. The landmark overlay on the photo keeps the first-pass coordinates, because that is the
image the user is looking at.

## D-035: Mirror-averaging is safe because the output is bilateral

EFM has no per-side sliders. Skyrim cannot represent an asymmetric face from this pipeline, so
measuring one pose-biased side is strictly worse than averaging both. The mesh is mirror-averaged
about its own symmetry axis before measuring.

Pairing the seventeen bilateral measurement landmarks comes from a fixed table rather than being
rediscovered per image. Geometric rediscovery fails exactly on an asymmetric face â€” the mirror of
a displaced landmark falls outside any safe matching radius â€” which is the case this whole feature
exists to handle. Contour points that only feed the on-screen diagnostic are still matched by
mutual nearest neighbour, where a mismatch is cosmetic.

## D-034: The user is told what was corrected and what was discarded

Silent correction is indistinguishable from a bug when the result looks wrong. The analysis panel
reports the tilt, turn, and nod that were removed, how many landmark pairs were averaged, and a
named list of every measurement left at the neutral default. Sliders whose measurement was faded
are flagged in the output panel â€” "neutral" when held entirely, a percentage when partly trusted â€”
so a held value reads as a known gap the user can fill in by hand, not as a measurement.

## D-033: EFM output is bounded at Â±3 and compressed, not clipped

RaceMenu's Expressive Facegen Morphs sliders are bounded at Â±3. The evidence is five unrelated,
hand-authored preset mods installed on this machine â€” Bella, Dua Lipa, Lulu, Maya, Natalya â€”
carrying 148 EFM entries between them: none outside Â±3.00, and four of the five touch exactly
3.00 on some slider. FaceForge 0.6.0 clamped at Â±10 and the shipped Homelander package carried
Â±8.5, which is what produced the "over-exaggerated high elf" result in game.

Range alone is not enough. Those same presets sit at mean |value| 0.48â€“1.11 with a 90th
percentile of 1.4â€“2.3, so a normal face must land in that band rather than resting against the
limit. Deviation is therefore passed through `3Â·tanh(x/3)`: linear for ordinary faces, bending
only near the edge, so an extreme measurement approaches Â±3 instead of a whole group of sliders
flattening onto the same maximum.

## D-032: Both brows must be measured in the same screen direction

The left brow was measured landmark 70 â†’ 107 and the right brow 336 â†’ 300, which sweeps the
opposite way across the screen. `atan2` therefore returned an angle near Â±180Â° for the right
brow, and the left-minus-right difference reported roughly 87Â° of tilt for an almost flat brow.
`EFM_Brow_Angle` was consequently pinned at the maximum on every exported preset. The right brow
is now measured 336 â†’ 300 in the same left-to-right direction as the left.

## D-031: Head-part identity comes from the record, never from its name

An HDPT record states what it is. `Type` gives the category (Hair, Eyes, Eyebrows, FacialHair,
Scars, Face, Misc), `Flags` gives `Male`, `Female`, and `Playable`, and `ValidRaces` points at a
form list of the races that may wear it. FaceForge 0.6.0 read none of them and substring-matched
names instead, which both over-included (any record containing "eye") and under-included (a brow
whose name has no category word). On the installed library, 3,481 of 3,629 records carry a Type
and only 148 still need the name fallback.

Two gates are deliberately permissive. A record with neither gender flag is offered to both
sexes, because Skyrim does not restrict it. A `ValidRaces` list that cannot be resolved against
installed plugins is reported as unknown and stays visible â€” never treated as "valid for no
race" â€” so an unparsed plugin hides nothing.

## D-030: The race and sex are chosen from installed RACE records

FaceForge parses the playable RACE records out of the installed base game rather than shipping a
hardcoded list of ten names. The geometry ranking still produces plain-English suggestions, but a
suggestion is only selectable when it matches a real installed record. The chosen race and sex
filter the head-part lists and are written into the export README and manifests, because RaceMenu
silently ignores head parts that are invalid for the active race or sex â€” which made a correct
selection in FaceForge look broken in game.

## D-029: The follower handoff names only paths RaceMenu writes and FollowerForge reads

The 0.6.0 export manifest told the user to expect `Data/Meshes/CharGen/Exported/<name>.nif` and
`Data/Textures/CharGen/Exported/<name>.dds`. Neither exists. RaceMenu writes the companion head
mesh and tint texture as `Data/SKSE/Plugins/CharGen/<name>.nif` and `.dds` beside
`Presets/<name>.jslot` â€” the layout used by every preset mod installed here and by all five
supplied reference packs â€” and FollowerForge's CharGen discovery enumerates NIF files in
`Data/SKSE/Plugins/CharGen`. The follower path could therefore never complete regardless of what
the user did in game.

FaceForge still cannot produce the NIF or DDS itself; only the running game knows the active
race, sex, head parts, TRI topology, and tint layers. What it can do is close the loop, so a
baked-head check now scans the indexed Data folder for the finished trio and adopts it as the
Follower Head Kit source.

## D-028: Skin, body, and overlays are not selectable head parts

FaceForge only offers parsed HDPT records for brows, eyes, and hair. Texture overlays, skin replacers, body replacers, and unrelated follower mods are excluded instead of being presented as facial-part recommendations.

## D-027: A JSlot-only package is a RaceMenu export stage, not a follower

The former New Follower Workflow did not contain FaceGeom NIF, FaceTint DDS, or an NPC plugin. It is now named RaceMenu Head Export and explicitly stops at the JSlot plus exact selection/dependency manifests. RaceMenu must materialize the matching NIF/DDS, after which FollowerForge handles race, voice, class, placement, equipment, spells, perks, behavior, and the NPC plugin.

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


