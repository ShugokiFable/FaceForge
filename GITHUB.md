# GitHub

| | |
|--|--|
| **Repo** | https://github.com/ShugokiFable/FaceForge |
| **Clone** | `git clone https://github.com/ShugokiFable/FaceForge.git` |
| **Account** | ShugokiFable |
| **Default branch** | `main` |
| **Owner work root** | workspace `FaceForge` |
| **Current ship tree** | `FaceForge 0.23.2/` (see `CURRENT.txt`) |

## What to push

CURRENT ship tree + root docs (no bin/obj/dist/artifacts/node_modules/wasm).
Binaries on **GitHub Releases**.

`powershell
git remote -v   # https://github.com/ShugokiFable/FaceForge.git
git add -A
git commit -m "Describe the change"
git push origin main
gh release create v0.23.2 --title "FaceForge 0.23.2" --notes-file release-notes-0.23.2.md FaceForge-0.23.2-STANDALONE.zip
`
"@, [Text.UTF8Encoding]::new(False))

[IO.File]::WriteAllText((Join-Path Z:\Backup\!Skyrim AE\!!!SkyrimAEaiWorkspace\FaceForge "UPLOAD-HERE.txt"), @"
Nexus / GitHub upload:
  NEXUS-UPLOAD\FaceForge-0.23.2-STANDALONE.zip

Size: 119117953
SHA-256: 3FE09DFED18BCCE52EEBF676E5D5DCE1059D3CFD7738C5C769C2FF7FFD64D6B1

Contains: FaceForge-0.23.2-STANDALONE.exe + README.md
CURRENT: FaceForge 0.23.2