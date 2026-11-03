# Upstream

This repo is a standalone desktop build of **Lab Planner & ELN**. `backend/`, `frontend/`,
the tests and the dev scripts were vendored once from the web app and are maintained
separately: no submodule, no shared build, nothing here reads or writes the web repo's
source or its data folder.

```
vendored-from: 612dbc5e6d5ca0c7ad23b57b16d2d703611eb51b
vendored-on:   2026-11-03
web-app repo:  C:/Users/bryce/Desktop/Repos/Lab Planner and ELN
```

## Porting a change from the web app

```powershell
git -C "..\Lab Planner and ELN" log --oneline 612dbc5..HEAD                       # what is not ported yet
git -C "..\Lab Planner and ELN" diff 612dbc5..HEAD -- backend/app/main.py         # the patch to re-apply
```

Keep the file layout identical to the web repo wherever a desktop change is not forced, so
those diffs stay readable. Desktop-only code lives in new files (`backend/desktop.py`,
`backend/app/seed.py`, `packaging/`), never inline in files the web repo also edits.

Bump `vendored-from` when the port lands.

## Files the desktop build does not need

Deleted from the vendored copy; none is referenced by the app or by its checks.

| Path | Why it went |
|---|---|
| `frontend/README.md` | create-vite boilerplate (`# React + TypeScript + Vite`) |
| `frontend/src/App.css` | nothing imports it - styles live in `index.css` plus the component CSS files |
| `frontend/src/assets/hero.png`, `react.svg`, `vite.svg` | create-vite boilerplate; the hero image the UI shows ships inside the notebook (`seed/uploads`) |
| `frontend/public/icons.svg` | no reference in `src/` or `index.html` |
| `backend/uploads/` (`/.gitkeep`) | the web layout's data folder. This build writes to `%LOCALAPPDATA%\Benchflow` (`app/paths.py`) |

`tests/test_parity_with_web.py` fails on any *other* web-app file that goes missing; these are in
its `DROPPED` set, so a future re-vendor does not quietly re-add them.

## Data seed

`seed/` (gitignored except the notebook itself) is a **copy** of the web app's data at the
moment of the snapshot, used to seed the desktop app's own data folder on first run
(`backend/app/seed.py`). It is rebuilt by `packaging/build.ps1` from
`<web-app repo>/backend/data` + `backend/uploads`. Nothing ever copies the other way.
