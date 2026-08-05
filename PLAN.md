# FaceForge 0.22.0 plan

Implementation status: complete; tool-validated standalone release.

## Goal

Stop treating every successful landmark detection as trustworthy. Stylized art and badly posed
photos can yield a complete mesh whose measurements are nevertheless misleading; optional vision
must then interpret the source from a neutral Skyrim foundation instead of adding small deltas to
the misleading local preset.

## Implementation

- Preserve 0.21.1 and edit only the full-copy 0.22.0 successor.
- Derive one deterministic reliability verdict from existing pose, pairing, asymmetry, source
  quality, and per-slider confidence evidence.
- Show the verdict and its reasons next to the analysis rather than presenting all outputs as
  equally certain.
- Use full interpretation from neutral for stylized or unreliable results; retain conservative
  refinement for reliable photographs.
- Keep vision explicitly user-triggered and consent-gated. Do not silently search for references
  or upload a face.

## Completion gates

- A reliable photo requests bounded refinement and applies it to its local values.
- A stylized or poor-pose result requests full interpretation and applies it to neutral values.
- The request prompt, schema bounds, desktop bridge, and frontend baseline agree on the mode.
- Frontend tests, native assertions, TypeScript/Vite, .NET build, single-file gate, and isolated
  standalone launch pass.

## Runtime boundary

Provider prompt plumbing and mode selection can be tool-validated. Visual likeness, live provider
quality, RaceMenu loading, the NIF/DDS bake, and follower construction remain user-side tests.
