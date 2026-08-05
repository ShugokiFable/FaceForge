# FaceForge requirements ledger

## FaceForge 0.22.0

| ID | Requirement | Evidence |
|---|---|---|
| R-022-01 | Preserve 0.21.1 and work only in a full-copy successor. | 1,015 files / 882,770,886 bytes copied with path/length parity |
| R-022-02 | Detect stylized or unreliable local results before vision. | deterministic reliability verdict and frontend regression |
| R-022-03 | Rebuild unreliable results from neutral, not from bad values. | explicit interpretation mode drives frontend baseline and native +/-3 schema |
| R-022-04 | Keep clean photo refinement conservative. | clean-photo browser QA and native +/-1 schema assertion |
| R-022-05 | Explain the decision to the user. | rendered recommendation banner, reason list, and adaptive button label |
| R-022-06 | Keep uploads opt-in and avoid silent web identity search. | existing consent gate preserved; no search/upload automation added |
| R-022-07 | Ship one shareable Windows EXE. | single-file publish and isolated one-file launch |

## Historical 0.6.0 ledger

| ID | Requirement | Evidence |
|---|---|---|
| R-001 | Preserve 0.5.0 and work only in a full-copy 0.6.0 successor. | 878 files / 1,013,323,260 bytes copied with parity |
| R-002 | Replace whole-pack appearance cards with exact selectable records. | 2,939 deployed HDPT choices indexed live |
| R-003 | Show useful identity and dependency data. | name, EditorID, plugin/FormID, Vortex source, masters, and missing requirements rendered |
| R-004 | Help users find the actual matching item without inventing shape. | exact-record search plus descriptor-only matching and numeric-name warning |
| R-005 | Write chosen appearance records into the preset. | JSlot `formIdentifier` regression for `TRE_Brows.esp|000D92` |
| R-006 | Exclude skin/body/overlay packs from head-part choice. | Community Overlays negative regression and live index |
| R-007 | Stop claiming a JSlot-only package is a follower. | RaceMenu Head Export naming and no-follower disclosure |
| R-008 | Preserve exact NIF/DDS handoff paths and Follower Forge continuation. | export-job and appearance-selection manifest regressions |
| R-009 | Preserve photo, anime/art, multi-view, and 35-control generation. | 22 frontend tests passed |
| R-010 | Preserve automatic Skyrim/Vortex/CharGen discovery. | live read-only deployment index passed |
| R-011 | Ship one self-contained, user-friendly Windows EXE. | release audit folder contained one EXE and launched for 12 seconds |
| R-012 | Distinguish tool validation from in-game likeness evidence. | validation/runtime boundary |
