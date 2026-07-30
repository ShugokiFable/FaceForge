# FaceForge 0.8.0 plan

Implementation status: complete; tool-validated standalone release.

## Goal

Make an imperfect photograph import properly. A perfectly front-facing, neutral-expression photo
is hard to get, and 0.7.0 only *warned* about tilt, turn, and expression before writing the
contaminated measurements into the preset anyway.

## Principle

Two different problems, two different answers:

- **Recoverable geometry gets corrected.** Tilt is a 2D rotation and can be undone exactly. Turn
  and nod foreshorten one axis by a cosine that can be divided back out. Left/right differences
  are removed by mirror-averaging, which is safe because EFM sliders are bilateral — Skyrim
  cannot represent an asymmetric face, so trusting one pose-biased side is strictly worse than
  averaging both.
- **Unrecoverable information gets distrusted, never invented.** A smile genuinely widens the
  mouth and a blink genuinely closes the eye. No maths recovers the neutral shape from one frame,
  so those measurements fade toward the neutral baseline in proportion to their contamination and
  the user is told which ones and why.

## Implementation

- Preserve FaceForge 0.7.0 and work only in a full-copy 0.8.0 successor.
- Straighten a tilted image and re-run landmark detection before measuring. Detection is not
  rotation invariant; de-rotating only the landmarks leaves the model's own error in place.
- Estimate tilt from the eye line, and turn and nod from landmark depth.
- Rotate out any residual tilt, then un-foreshorten widths by `1/cos(yaw)` and heights by
  `1/cos(pitch)`, capped at 32°.
- Past the cap, drop `widthConfidence` / `heightConfidence` instead of scaling further.
- Mirror-average the mesh about its own symmetry axis using a fixed table for the seventeen
  bilateral measurement landmarks and mutual-nearest-neighbour matching for cosmetic contour
  points.
- Fade each measurement by the product of its pose confidence and every expression rule that
  moves it, then report the causes and the held measurements.
- Show tilt/turn/nod/mirrored-pairs in the analysis panel and flag faded sliders in the output
  panel.

## Completion gates

- A tilted source measures the same as the straight one, end to end through the real model.
- A turned source recovers its front-facing widths.
- A lopsided source becomes symmetric, and an asymmetric brow reports the average tilt.
- An open mouth, closed eyes, or a strong smile leave the affected sliders at neutral and say so.
- A clean front-facing neutral source is left completely untouched.
- Frontend tests, native assertions, live deployment index, TypeScript/Vite, .NET build, rendered
  browser QA including the rotated-source stage, single-file gate, and isolated launch pass.

## Runtime boundary

Correction and trust are proven against synthetic geometry and one real portrait re-imported at a
16° tilt. Wider photographic variety, in-game likeness, the RaceMenu head bake, and Follower Forge
construction remain user-side runtime tests.
