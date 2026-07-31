# GitHub

| | |
|--|--|
| **Repo** | https://github.com/ShugokiFable/FaceForge |
| **Clone** | `git clone https://github.com/ShugokiFable/FaceForge.git` |
| **Account** | ShugokiFable |
| **Default branch** | `main` |
| **Owner work root** | workspace `FaceForge` (versioned snapshots under this folder) |
| **Current ship tree** | `FaceForge 0.21.1/` (see `CURRENT.txt`) |
| **This folder** | canonical publish home for this app |

## What to push

Publish FaceForge **CURRENT** snapshot plus workspace docs:

- `FaceForge 0.21.1/` source, scripts, README, VERSION, qa (no `bin/`, `obj/`, `dist/`, `node_modules/`, `artifacts/`, MediaPipe wasm copies)
- Root `README.md`, `CHANGELOG.txt`, `CURRENT.txt`, `PLAN.md`, `STATE.md`, `VALIDATION.md`, `DECISIONS.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `WORKSPACE_OWNERSHIP.md`, `GITHUB.md`, `release-notes-0.21.1.md`

Release binaries live on **GitHub Releases**, not in git history.

## Agent update checklist

1. Edit **only** under this owner root.
2. Version via `skyrim-versioned-workspace`; update `CURRENT.txt` / `CHANGELOG.txt`.
3. Stage the **CURRENT** ship tree and root docs.
4. **Exclude:** secrets (`.env`, API keys), `bin/`, `obj/`, `node_modules/`, `dist/`, `artifacts/`, `MEMORY/`, superseded version folders, game masters, MediaPipe wasm.
5. Commit on `main` and push:

```powershell
git remote -v   # must be https://github.com/ShugokiFable/FaceForge.git
git add -A
git status
git commit -m "Describe the change"
git push origin main
```

6. Ship a release when the standalone EXE is ready:

```powershell
gh release create v0.21.1 `
  --title "FaceForge 0.21.1" `
  --notes-file release-notes-0.21.1.md `
  "FaceForge 0.21.1 - STANDALONE.exe"
```

## Do not

- Create a second GitHub repo with a different name for the same app.
- Push Claude/GPT/Grok twin trees to different remotes.
- Commit API keys, Vortex deployments, or full game ESMs.
