# Upstream source snapshot

This repo is a **standalone** desktop app. Its `backend/`, `frontend/`, tests and dev
scripts were vendored **once** from the web app; after that the two repos do not share
files.

- **Vendored from:** `C:/Users/bryce/Desktop/Repos/Lab Planner and ELN`
- **vendored-from:** `612dbc5e6d5ca0c7ad23b57b16d2d703611eb51b`
- **Date:** 2026-11-03
- **Method:** `git -C "<web-repo>" archive --format=tar HEAD | tar -x` (tracked files only;
  venv/, node_modules/, dist/, data/, uploads/ excluded by the web repo's .gitignore)
- **Data seed:** `seed/` = one-way copy of the web app's `backend/data/benchflow.db`,
  `lab_state.json` and `backend/uploads/` (54 files, ~54 MB). Copied, never moved; the
  web app's data folder is untouched.

## Keeping the port queue readable

Features or fixes that land in the web app after the snapshot do **not** appear here
automatically. To see what is unported:

```powershell
git -C "..\Lab Planner and ELN" log --oneline 612dbc5..HEAD
git -C "..\Lab Planner and ELN" diff 612dbc5..HEAD -- backend/app/main.py
```

Keep the file layout identical to the web repo where a desktop change is not forced, so
those diffs stay re-applyable by hand. Desktop-only code lives in new places
(`backend/desktop.py`, `packaging/`, `backend/app/seed.py`), never inline in files the
web repo also edits.
