# FaceForge 0.24.0

Faces come out shaped, not over-shaped. Two long-standing defects made exports coarse and exaggerated (especially brows).

## Fixes
1. **One measurement, one family** — EFM/CME/NSK/SPG are separate morph sets that RaceMenu **sums**. FaceForge no longer writes the same measurement into every family (up to 4× brow/jaw/etc.).
2. **Estimated baselines capped** — brow height/width/thickness, iris size, and lip gap use estimated divisors (Skyrim paints brows/irises as textures). They keep direction but are limited so they cannot slam the end of the range on every face. Measured axes (jaw, nose, cheeks, …) are unchanged.

## Download
`FaceForge-0.24.0-STANDALONE.zip` — unzip anywhere, run the EXE (Windows **tool**, not a Skyrim mod).

Re-export presets from earlier versions, especially if you loaded a slider inventory.

Zip: 119121339 bytes  
SHA-256: `E0F1F257F2BD09681252FEA1886DA150565EEA83FA050082D2857B1F96342937`