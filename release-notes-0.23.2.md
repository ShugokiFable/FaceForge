# FaceForge 0.23.2 (hotfix)

**0.23.0 and 0.23.1 dropped ~42 working sliders** on High Poly Head setups. This release restores full slider output (back to the 0.22.0 set).

## What was wrong
FaceForge decided which RaceMenu sliders your head can move by reading morph registrations. It only read **loose** files, so it never saw High Poly Head's morphs.ini (and related registrations) packed inside **High Poly Head.bsa**, and treated those sliders as dead.

## Fixed
- BSA index for archives that declare facegenmorphs content (no full extract)
- Incomplete morph registry **refuses to drop** sliders (can prove live, never guess dead)
- morphs.ini parser reads **every** extension on a multi-extension line
- Reverted wrong HPH/EFM calibration note

## Download
`FaceForge-0.23.2-STANDALONE.zip` — unzip anywhere, run the EXE (Windows **tool**, not a Skyrim mod).

If you exported with 0.23.0 or 0.23.1, **re-export** with 0.23.2.

Zip: 119117953 bytes  
SHA-256: `3FE09DFED18BCCE52EEBF676E5D5DCE1059D3CFD7738C5C769C2FF7FFD64D6B1`