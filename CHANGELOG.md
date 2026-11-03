# Changelog

Dates are the day the work was checked against a build, not the day it was written.
The web app is the reference implementation — see `UPSTREAM.md` for which commit was vendored.

## 1.0.0 — 2026-11-03 — first desktop build

Vendored from the Lab Planner & ELN web app at `612dbc5` (`UPSTREAM.md`). This is a Windows app:
one `Benchflow.exe`, installed per user without admin rights, notebook and uploads in
`%LOCALAPPDATA%\Benchflow`. Nothing about it needs Node, Python, Docker or a browser tab.

### What is in it

- **The web app, one process.** uvicorn on `127.0.0.1` in a thread, WebView2 window in the main
  thread, and the API serves the built frontend itself, so window and API share one origin and
  there is no CORS (`docs/adr/0001-api-runs-inside-the-window-process.md`).
- **First run.** Asked once, before anything is written: copy an existing notebook in (it is
  copied, the original is never written to; the folder picker defaults to the notebook bundled in
  `seed\`), or start with an empty notebook. A network share is refused.
- **One window at a time.** Exclusive lock file plus a liveness check; a second launch raises the
  window that is already there, and a lock left behind by a crash or a killed test run does not
  wedge startup (see the empty-`desktop.lock` fix below).
- **CLI on the same exe.** `--version`, `--help`, `--mcp` (read-only notebook tools over stdio,
  `MCP_setup.md`), `--backup`, `--restore`, `--import`. A windowed exe has no console, so these
  re-attach the terminal's console; run output also goes to `%LOCALAPPDATA%\Benchflow\logs`.
- **Backups.** OneDrive-friendly folder, one snapshot per close, `history\` keeping 14, restore
  through the app or `--restore`. Backups while the app is closed are the optional scheduled task
  (`Benchflow.exe --backup`) — the installer does not create it, you add it once.
- **Installer.** Inno Setup script (`packaging\setup.iss`), app icon, per-user install without admin
  rights, and uninstalling removes the program only — the notebook stays. Built and installed once,
  on the development machine; see gap 5 below for what that does not prove.
- **SharePoint export.** The notebook as JSON plus the attachment copies its content actually
  references, written into a folder the SharePoint/OneDrive client already syncs
  (`app/sharepoint_export.py` — there is no `.docx` anywhere in this repo). It runs on shutdown when
  a folder is configured. Note for the release: the interface has **no card for it** — you set
  `sharepoint_dir` through `PUT /api/sharepoint/config` (`docs\setup.md` has the one-liner). Upstream hid
  that card on purpose (web repo `87e9560`, "hide SharePoint settings"), so it is not a desktop
  regression — but it does mean the feature is off unless someone knows the setting exists.
- **Native folder dialogs** for the backup folder (`app/dialogs.py`); the web app's iframe-based
  folder browser is not in this repo.
- **Docs.** `docs/setup.md` (install, data locations, what to send support), `docs/security-checklist.md`,
  `docs/parity-checklist.md`, `docs/adr/0001-...`.

### How to check this release

```powershell
venv\Scripts\python.exe -m pytest backend\tests -q                 # 48 checks, no network
venv\Scripts\python.exe backend\tests\test_parity_with_web.py     # this repo vs the web repo
venv\Scripts\python.exe packaging\test_frozen.py                  # drives dist\Benchflow\Benchflow.exe
```

### Deliberate differences from the web app

`app/paths.py` (state in `%LOCALAPPDATA%`, `BENCHFLOW_DATA_DIR` etc.), `app/database.py` (SQLite
only — no PostgreSQL), `app/main.py` (first-run import, static mount, and the CSRF guard: writes
from a foreign `Origin` are refused, and the web app's `allow_origins=["*"]` is not carried over),
native folder dialogs in `app/dialogs.py`, `desktop.py` living under `backend/`, and `README.md`
(opened with a section on what this repository builds — the rest is the web app's own feature
documentation). The parity test
(`backend/tests/test_parity_with_web.py`) prints every file whose content differs; anything in that
list you did not choose is a bug.

### Fixed during the release work

- **An empty `desktop.lock` wedged every later start — the app looked like it would not launch.**
  The lock file is created empty and filled in with `port pid create-time` only once the server is
  up, so a process killed in between (a force-quit, `--debug`, the frozen smoke test) left a blank
  file. `acquire_instance_lock` deleted a lock only when it could *parse* one, so a blank file fell
  through to "another instance owns the app": `run_window` called `activate_other_instance()`, which
  read nothing and returned 0. Double-clicking then did literally nothing — no window, no log line,
  exit code 0. Any lock file that no live process owns is now deleted. Covered by
  `test_an_empty_lock_file_does_not_wedge_startup`.
- **`--version` was documented everywhere and implemented nowhere**: `Benchflow.exe --version` died
  with `unrecognized arguments`. It now prints `Benchflow <APP_VERSION>`, the same string the
  manifests and the installer version come from.
- **`build.ps1` could not find Inno Setup** installed unelevated by `winget` — that puts it at
  `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`, off `PATH`. It looks there now (`$env:ISCC` still
  wins).
- **`private_mode=True` → `False` in `backend/desktop.py`.** pywebview's edgechromium backend passes
  it straight to WebView2's `IsInPrivateModeEnabled`, which keeps `localStorage` in memory — the web
  app's saved preferences (sidebar width, calendar tray, snap-to-grid) would have vanished on every
  restart, breaking parity row 11. Found by reading the requirement against pywebview's source, not
  by a test, so it is now pinned by
  `backend/tests/test_desktop_cli.py::test_the_window_keeps_its_profile_and_binds_only_to_loopback`
  together with the loopback bind and the empty-lock case.
- **`backend/tests/test_api_safety.py` imports the app lazily.** It sorts before the vendored
  `test_backup.py`, which must be the first module in the process to import `app.paths` (it aims the
  app at its own temp folder and asserts the aim took). One `pytest backend/tests` run is now green:
  47 passed.
- **Two tests added to `test_parity_with_web.py`**: no vendored file lost, and MCP tools/resources
  match the web repo's `mcp_server.py` with `READ_ONLY` annotations and a notebook opened
  `?mode=ro` + `PRAGMA query_only=ON`.
- **Not fixed here — two problems in the web repo's own suite**, both present on an unmodified
  checkout (so not porting damage): `backend/test_api.py::test_backend` asks for a `client` fixture
  that does not exist (collection error), and
  `backend/tests/test_backup.py::test_paths_env_override` passes alone but fails when the whole suite
  runs, because those tests inherit whatever `BENCHFLOW_*` variables the previous test left set. This
  repo's copy of `test_backup.py` passes because `backend/tests/conftest.py` clears those variables
  before every test. 48 passed as of the lock fix.
- **Vendored docstring lie, left as upstream wrote it:** the header of `app/sharepoint_export.py` says
  the export runs on shutdown "when `BENCHFLOW_SHAREPOINT_DIR` is set". Nothing reads that variable —
  the folder lives in the database (`sharepoint_dir`). Same false sentence in the web repo, so it is
  not corrected here; the docs describe what the code really does.
- **`packaging/test_frozen.py`** now also fails if a cloud SDK (`boto3`, `azure*`, `msal`, `google*`,
  …) turns up in the bundle, or if data/logs/`benchflow.db` appear next to the exe.

### Not verified as of this release (every one is a release blocker per the plan)

These are the ✗ / empty rows in `docs/parity-checklist.md`, spelled out:

1. **ND2 attachment preview (row 3) — no sample exists.** Neither repo contains a `.nd2`, so
   `test_frozen.py` cannot upload one into the frozen exe. The ND2 code path is the same Python the
   web app runs, but the PyInstaller question (does `imagecodecs`/`tifffile` read an ND2 inside
   `_MEIPASS`) is unproven. Drop a real `.nd2` into `seed\uploads\` and the frozen test picks it up
   by itself.
2. **OneNote `.one` import (row 5) — needs the same sample the web app imported.** `aspose.note` and
   its `Python.Runtime.dll` are bundled, but the assembly loads only when an import actually runs, so
   a broken bundle would surface as an error at import time, not at startup. Experiment counts must
   be compared against the web app's import of the same file.
3. **The `private_mode` fix above is not proven by running the UI** — only pinned at the source
   level. Row 11 still needs: set a sidebar width, close, reopen, confirm it survived.
4. **Every `human` row in the parity table and the launch checklist** — double-click launch with no
   console window and the Benchflow taskbar icon, a clean laptop with no Node/Python, the native
   folder dialog in Settings, the scheduled backup task while the app is closed, and uninstall →
   reinstall keeping the notebook. None of that can be checked from this environment; each is a
   click-through on the machine the app will actually live on.
5. **The installer has only ever been run on the machine that built it.** `packaging\build.ps1`
   produced `dist\installer\Benchflow-1.0.0-Setup.exe` (68 MB) on 2026-11-03; it installed silently
   into `%LOCALAPPDATA%\Programs\Benchflow`, and that installed `Benchflow.exe` started, served
   `/api/health` and wrote its log. What that does not cover: a laptop with no Node/Python and no
   Visual C++ redistributable, the first-run window and taskbar icon, and uninstall → reinstall.
   Nothing is code-signed, so a fresh laptop will show SmartScreen ("More info → Run anyway").

### Still open

Which repo is the source of truth from here on. The plan's rule is that a fix in one tree is
expected in the other; `test_parity_with_web.py` and `UPSTREAM.md` make the drift visible, but nobody
has decided the direction yet.
