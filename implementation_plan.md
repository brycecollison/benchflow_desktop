# Benchflow Desktop — Implementation Plan

Port of **Lab Planner & ELN** (`../Lab Planner and ELN`) from a browser + two dev
servers into one self-contained Windows desktop application.

Source repo of record: `C:/Users/bryce/Desktop/Repos/Lab Planner and ELN`
All file paths below are relative to that repo unless stated otherwise.

---

## 1. Goal

One installed application that:

1. Opens from the Start Menu with an icon, no terminal, no browser tab.
2. Runs the FastAPI backend and the built React UI **in one installation**, on one
   origin, with no Node or Python installed by the user.
3. Keeps the notebook where it is today (`benchflow.db` + `uploads/`) and migrates the
   existing data on first launch.
4. Keeps every existing guarantee: shutdown backup to OneDrive, SharePoint export,
   read-only MCP access, restore from a backup folder.

## 2. Non-goals

- No auto-updater, no code signing, no Microsoft Store. Decide later.
- No macOS/Linux build in the first pass (the spec is portable; the OneDrive/`winreg`
  logic is already guarded by `OSError`).
- No rewrite of the frontend. The React app is unchanged except where a phase says so.
- No new features while porting.

## 3. What exists today (verified, not assumed)

| Area | Fact |
| --- | --- |
| Frontend | React 19, Vite 8, Tailwind 4, Tiptap 3, Zustand. `frontend/dist` = 2.7 MB. |
| Frontend ↔ backend | Relative `/api/...` and `/uploads/...` only. Vite proxies both to `http://127.0.0.1:8000` (`frontend/vite.config.ts`). |
| External network | None. No CDN, no fonts, no analytics in `index.html` or `src/`. |
| Router | None in deps — views are switched in the Zustand store, so **no SPA history fallback is needed**. |
| Backend | FastAPI + SQLModel/SQLite. `backend/app/main.py` (506 lines), `backend/run.py` starts uvicorn with `reload=True`. |
| Data | `backend/data/benchflow.db` (1.4 MB), `backend/uploads/` (54 MB), `backend/data/lab_state.json`. |
| Data location | `backend/app/paths.py`: `DATA_DIR`/`UPLOAD_DIR` honour `BENCHFLOW_DATA_DIR` / `BENCHFLOW_UPLOAD_DIR`; defaults are the in-repo paths. |
| SQLite | `journal_mode=TRUNCATE`, `synchronous=FULL` — deliberate, for a cloud-synced data folder. Do not switch to WAL. |
| Heavy deps | `venv/Lib/site-packages` = 255 MB: imagecodecs 46M, numpy 34M + numpy.libs 21M, sqlalchemy 20M, dask 17M, PIL 16M, cryptography 11M. |
| OneNote import | `aspose-note-foss` is **666 KB, pure Python** (no .NET/JVM). Packaging risk much lower than usual. |
| Folder picker | `backend/app/folder_picker.py` shells out to `sys.executable` + tkinter because Tk needs its own process. Frozen apps have no usable `sys.executable`. |
| OneDrive detect | `main.py:165` reads `HKCU\Software\Microsoft\OneDrive\Accounts`, falls back to env vars, guarded by `OSError`. |
| MCP | `backend/mcp_server.py` is a **stdio** server reading the SQLite file directly (`BENCHFLOW_DB_PATH`), not HTTP. Port changes do not affect it; data-dir changes do. |
| Security | CORS `allow_origins=["*"]`, no auth, and `POST /api/lab/state` replaces the whole database. |
---
| Dev checks | Five `frontend/scripts/*-check.cjs` drive a browser at `:5173`. Dev mode must stay intact. |

---

## 4. Decision

**PyInstaller (onedir) + FastAPI serving `frontend/dist` + a pywebview window
(Edge WebView2).**

One Python process: uvicorn on an ephemeral 127.0.0.1 port, `/api` and `/uploads` as
today, `"/"` serving the built React app, wrapped in a native window. WebView2 is
already installed on Windows 10/11, so no Chromium is bundled.

This is a packaging job, not a port: the app is already local-first and offline.

Rejected, with reasons:

| Option | Why not |
| --- | --- |
| Electron | Bundles ~200 MB Chromium plus a Node shell orchestrating a Python child, for a worse result. Frontend is a Tiptap rich-text editor — the one part most sensitive to a Chromium version change. |
| Tauri v2 + sidecar | Needs a Rust toolchain and hand-written sidecar lifecycle (spawn, health-wait, kill-on-exit). pywebview already sits on WebView2, so the only gain is a smaller binary. |
| Edge/Chrome `--app` mode | Cheapest window there is, but the window is owned by the shared browser process, so you cannot reliably detect close — that silently drops `shutdown_export()` and `shutdown_backup()`, which the README promises. |
| Keep a launcher script + require Python/Node | Not self-contained; keeps the per-machine venv/wheel breakage documented in the README troubleshooting section. |

## 5. Target architecture

```
Benchflow.exe  (PyInstaller onedir, one process)
  ├─ argparse: run (default) | --mcp | --backup | --restore
  ├─ picks a free 127.0.0.1 port, uvicorn (reload=False)
  │    ├─ /api/...     FastAPI routes  (unchanged)
  │    ├─ /uploads     StaticFiles(UPLOAD_DIR)      main.py:248
  │    └─ /            StaticFiles(frontend/dist, html=True)   ← new, mounted last
  └─ pywebview window → http://127.0.0.1:<port>
       ├─ close event → graceful uvicorn shutdown → lifespan() runs
       │                  shutdown_export() (main.py:222) + shutdown_backup() (main.py:432)
       ├─ create_file_dialog(FOLDER_CHOOSER) → replaces tkinter folder_picker.py
       └─ WEBVIEW2_USER_DATA_FOLDER → persists the existing localStorage prefs

%LOCALAPPDATA%\Benchflow\        ← data leaves the code tree
  ├─ data/benchflow.db, lab_state.json
  ├─ uploads/
  └─ webview/            WebView2 profile
<install dir>\           read-only; frontend/dist lives in sys._MEIPASS
OneDrive\BenchflowBackup\        ← unchanged snapshot target
```

MCP clients keep reading the SQLite file directly: `Benchflow.exe --mcp` with
`BENCHFLOW_DB_PATH=%LOCALAPPDATA%\Benchflow\data\benchflow.db`.


## 6. Phases

Every phase lands green on its own and leaves dev mode working. Effort is for one
developer; total ≈ 5 working days, and Phase 2 is the only genuinely uncertain part.

### Phase 0 — Single origin, no Vite at runtime (½ day) — do this first

**Files:** `backend/app/main.py`

1. After the `/uploads` mount and after all routes, add
   `app.mount("/", StaticFiles(directory=<dist>, html=True))`. Mount it **last** so
   `/api` and `/uploads` keep precedence. No SPA fallback route (no router).
2. Resolve `dist` from a module-level constant that Phase 2 will switch to `sys._MEIPASS`;
   in dev it is `<repo>/frontend/dist`.
3. Do not touch `frontend/vite.config.ts` or `start-dev.ps1` / `start-dev.sh`.

**Acceptance:** `npm --prefix frontend run build`, then `python run.py`, then
`http://127.0.0.1:8000/` is the whole app — navigate every view, save state, upload a
file, open a preview image. `bash start-dev.sh` still works and the five
`frontend/scripts/*-check.cjs` browser checks still pass against `:5173`.

**Frontend changes: none.** Relative paths now hit the same origin.

### Phase 1 — Data out of the code tree + migration (½ day) — highest blast radius

**Files:** `backend/app/paths.py`, one small new `app/migrate.py`, `README.md`

1. Defaults when frozen: `DATA_DIR = %LOCALAPPDATA%\Benchflow\data`,
   `UPLOAD_DIR = %LOCALAPPDATA%\Benchflow\uploads`. Env-var overrides unchanged, so
   the existing multi-machine `BENCHFLOW_DATA_DIR` workflow survives.
2. `BASE_DIR` must not be used as a data root once frozen (`paths.py:12` is
   `Path(__file__).parent.parent`, which lands inside the read-only bundle). Add
   `APP_ROOT` = `sys._MEIPASS` when frozen, else the repo backend dir.
3. One-time migration on first launch, before `init_db()`: if the new db does not exist
   and the old one does, copy `benchflow.db`, `lab_state.json` and every file in the old
   `uploads/` into the new location, then rename the old tree to `data.pre-migration/`
   and `uploads.pre-migration/` rather than deleting it. Never overwrite an existing file.

**Acceptance:** point a fresh build at a **copy** of the real `backend/data` +
`backend/uploads` (54 MB, the actual notebook). Assert project/experiment counts, every
attachment still resolves under `/uploads/...`, and that opening a preview works. Then
run the restore path (`Settings → Personal OneDrive Backup`) against a previous snapshot.
**Do not proceed to Phase 2 until this has been tested on a copy twice.**

### Phase 2 — Freeze the backend (1–2 days, the risky phase)

**Files:** new `packaging/benchflow.spec`, new `backend/desktop.py` (entry point),
`backend/requirements.txt` (add `pyinstaller` under a dev-only section)

1. `desktop.py`: strip `reload=True` from the uvicorn path (`run.py` stays as the dev
   entry). Pick a free port with the bind-socket-0 trick, start uvicorn in a thread, poll
   `/api/health` until it answers, then open the window. Keep binding **127.0.0.1**.
2. `benchflow.spec`: **onedir** (not onefile — onefile re-extracts 250 MB on every launch
   and will look like a hang). `contents_collection` for `frontend/dist`.
   Hidden imports / `collect_submodules` for: `aspose.note`, `tifffile`, `nd2`,
   `imagecodecs`, `skimage` bits pulled by `image_processor.py`, `winreg`, `tkinter`
   (only if Phase 3 keeps it). Exclude `pip`, `pywin32`'s `pythonwin`, `pywin32_system32`
   leftovers, `pytest`, the `tests/` tree.
3. `backend/app/image_processor.py` must be exercised from inside the frozen build —
   `tifffile`/`nd2`/`imagecodecs` load binary plugins and are the usual PyInstaller
   failure here.

**Acceptance:** a new small test, `packaging/test_frozen.py` (self-check style, like
`backend/tests/test_backup.py`): launch the built exe headless, poll `/api/health`,
assert `GET /` returns the built `index.html`, `POST /api/lab/upload` a real `.tif` and
a real `.nd2` from `backend/uploads/` and assert a `_preview.png` comes back, then kill
the process and assert the shutdown snapshot ran. Unpacked size expectation 150–250 MB.

### Phase 3 — The window (1 day)

**Files:** `backend/desktop.py`, delete `backend/app/folder_picker.py` + `backend/tests/test_folder_picker.py`,
`backend/app/main.py` (`/api/backup/browse`)

1. `webview.create_window("Benchflow", url, width, height)` + `webview.start()`.
   Set `WEBVIEW2_USER_DATA_FOLDER=%LOCALAPPDATA%\Benchflow\webview` **before** import,
   so the existing localStorage keys (`lab_sidebar_width`, `lab_calendar_tray_open`,
   `lab_snap_grid`, …) persist across restarts instead of resetting every launch.
2. On the window close event: signal the uvicorn thread to stop and wait for it, so the
   existing `lifespan` shutdown runs `shutdown_export()` and `shutdown_backup()` exactly
   as the dev launcher does today. Also install a `SIGTERM` handler.
3. Replace the folder dialog: `/api/backup/browse` calls a pywebview
   `create_file_dialog(webview.FOLDER_CHOOSER)` instead of the tkinter subprocess. Keep
   the existing 503 fallback message for when the dialog is unavailable, and keep the
   manual path entry in Settings.
4. Single-instance lock: a named mutex/lockfile. A second launch focuses the first window
   and exits. Two writers on one SQLite file is the one way to corrupt the notebook.
5. Icon, window title, and a Start-Menu shortcut with an `AppUserModelID` so the taskbar
   icon is the app and not `pythonw`.

**Acceptance:** double-click the exe → window, no console window, no browser tab.
Close it → the backup folder gets a new `history/benchflow-*.db`. Relaunch → sidebar
width and calendar tray state are remembered. Settings → Browse opens a **native** folder
dialog, and Cancel leaves the configured path unchanged (the behaviour README documents).


### Phase 4 — Entry-point modes (2 h)

**Files:** new `backend/desktop.py` (argparse), `README.md`, `MCP_setup.md`

Four modes in one executable — no extra binaries:

| Invocation | Replaces |
| --- | --- |
| `Benchflow.exe` | `start-dev.ps1` + a browser tab |
| `Benchflow.exe --mcp` | `<repo>\venv\Scripts\python.exe backend\mcp_server.py` in every MCP client config |
| `Benchflow.exe --backup` | `python -m app.backup` in Task Scheduler and in the dev launcher's exit hook |
| `Benchflow.exe --restore <dir>` | the manual "copy the snapshot back" step (optional, cheap) |

`backend/app/backup.py` keeps its own CLI so the dev repo is unaffected; `--backup` is a
thin wrapper over `backup_run()` in `main.py` so the scheduled task records the same
"last backup" the Settings card shows. `mcp_server.py` itself does not change.

Update `MCP_setup.md` client JSON to the exe path plus
`BENCHFLOW_DB_PATH=%LOCALAPPDATA%\Benchflow\data\benchflow.db`, and keep the existing
"point it at a copy, not the live notebook" advice.

**Acceptance:** `Benchflow.exe --mcp` answers `tools/list` over stdio; the scheduled task
runs `--backup` while the app is open and appends to `history/` (keep 14) — it is an
online backup, not a file copy.

### Phase 5 — Local API hardening (1 h, do not skip)

**Files:** `backend/app/main.py` (the `CORSMiddleware` block, ~line 240)

Today: `allow_origins=["*"]`, no auth, and `POST /api/lab/state` replaces the whole
database. On a fixed dev port that is a shrug; as "the desktop app" it is how a stray web
page wipes the notebook. A random port is not a credential.

1. Drop `allow_origins=["*"]`. Phase 0 made everything same-origin, so allow the exact app
   origin and reject mutating requests whose `Origin` header is foreign or absent.
2. Keep the bind on 127.0.0.1 (already true) — never `0.0.0.0`.
3. A per-session token in the URL is only needed if a plain-browser client is kept
   (open question 2).

**Acceptance:** a test asserting a `POST /api/lab/state` with `Origin: http://evil.example`
is rejected while the app's own origin still saves; `backend/test_api.py` still passes.

### Phase 6 — Installer and release (½ day)

**Files:** `packaging/setup.iss` (Inno Setup), `packaging/icon.ico`, `packaging/build.ps1`
(npm ci → npm run build → pyinstaller → iscc)

1. Inno Setup packs the onedir folder. Per-user install (no admin), Start-Menu + desktop
   shortcut, and an uninstaller that **does not delete** `%LOCALAPPDATA%\Benchflow` — state
   that in the uninstall prompt.
2. No auto-updater. Release = install a new build over the old one; data and the WebView2
   profile live outside the install dir, so they survive. Keep a `CHANGELOG.md` and tag.
3. Ship the onedir zip as the portable fallback.

**Acceptance:** on a clean Windows profile with **no** Node, Python or manually installed
WebView2: install → launch → migrated notebook opens → upload → backup → restart → the MCP
client reads it.

---

## 7. Risks, ranked

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **Migration destroys the only copy of the notebook** (real data, 54 MB of attachments, no undo) | Test on a copy twice before Phase 2; migration renames the old tree instead of deleting it; verify a `Settings → Backup` snapshot restore works. |
| 2 | **PyInstaller + `imagecodecs`/`tifffile`/`nd2` binary plugins fail inside `_MEIPASS`** — TIFF/ND2 preview generation dies silently | `packaging/test_frozen.py` uploads real `.tif`, `.nd2`, `.xlsx` from `backend/uploads/` and asserts previews. If a hook is hopeless, drop OneNote/TIFF support from v1 rather than ship a broken importer. |
| 3 | **WebView2 runtime missing** on an older machine → blank window | Probe the Evergreen/Flat RC registry key at startup; if absent, print the URL and open the default browser instead of showing a dead window. |
| 4 | **Two instances writing one SQLite file** | Single-instance lock (Phase 3). MCP stays read-only. |
| 5 | Live db left in a OneDrive-synced folder → online-only placeholders and `benchflow-DESKTOP-ABC.db` conflict copies | Data defaults to `%LOCALAPPDATA%`; keep `warn_if_code_in_onedrive()` and keep the snapshot as the only thing that travels. Do **not** switch to WAL — `TRUNCATE`+`synchronous=FULL` in `app/database.py` is deliberate. |
| 6 | Free-port change silently breaks something hard-coding 8000 | MCP reads the db file, not HTTP, so it is unaffected; dev keeps 8000. Grep for `8000` before shipping. |
| 7 | Bundle is large (150–250 MB unpacked) | Accept it. If it matters, the big wins are `dask` (17 M), `cryptography` (11 M) and pywin32's `pythonwin` (5 M) — all droppable without touching app code. |

---

## 8. Definition of done

- [ ] Double-click launch: window, app icon in the taskbar, no console, no browser tab.
- [ ] No Node or Python on the target machine; `npm` and `venv` are build-time only.
- [ ] Existing notebook migrated and verified; the pre-migration copy still on disk.
- [ ] Upload → TIFF/ND2 preview works in the frozen build (`test_frozen.py` green).
- [ ] Closing the window runs the shutdown export + backup; `history/` grows.
- [ ] `Benchflow.exe --mcp` serves the same tools as today; `MCP_setup.md` updated.
- [ ] `Benchflow.exe --backup` works as the scheduled task.
- [ ] Settings backup / SharePoint cards work with the native folder dialog; Cancel
      leaves the configured path unchanged.
- [ ] Foreign-origin writes to `/api/lab/state` are rejected; `test_api.py` passes.
- [ ] `bash start-dev.sh`, `start-dev.ps1`, `python run.py` and the five
      `frontend/scripts/*-check.cjs` browser checks still work — dev flow untouched.

## 9. Open questions — answer before Phase 5

1. **One machine or several?** The current workflow is two machines sharing OneDrive. With
   data in `%LOCALAPPDATA%`, each install owns its notebook and only the snapshot travels.
   Is per-machine notebook + restore-from-backup the intent, or does `BENCHFLOW_DATA_DIR`
   point at a synced folder (which re-opens risk 5)?
2. **Keep the browser as a client** (multi-device / remote access)? If yes, Phase 5's
   session token stops being optional and the app needs real auth.
3. **Is OneNote import still used?** `aspose-note-foss` + the 958-line
   `app/onenote_importer.py` are a large share of the bundle. Deleting them is the cheapest
   size win on the list — but only if the feature is dead.
4. **Sign the binary?** Unsigned means a SmartScreen prompt on every new build.

## 10. Build order

```
0 single-origin ──> 2 PyInstaller ──> 3 window ──> 4 modes ──> 6 installer
        |                                        \
        +--> 1 data + migration (test on a copy twice) --> 5 API hardening
```

Phase 1 may run in parallel with Phase 2, but must land and be verified before any build
is installed on the machine holding the real notebook. Phase 5 is small enough to fold into
Phase 0 — never to skip it.

## Appendix — anchors in the current code

| Concern | Where |
| --- | --- |
| App factory, lifespan, shutdown hooks | `backend/app/main.py` — `lifespan` (147), `shutdown_export` (222), `shutdown_backup` (432) |
| CORS block to replace | `backend/app/main.py` ~240 |
| `/uploads` static mount; add `/` mount after this | `backend/app/main.py` 248 |
| Data dirs, env overrides, `BASE_DIR` | `backend/app/paths.py` |
| SQLite pragmas (do not change) | `backend/app/database.py` |
| Backup snapshot + CLI | `backend/app/backup.py` (`run_backup`, `python -m app.backup`) |
| Folder dialog to replace | `backend/app/folder_picker.py`, `backend/tests/test_folder_picker.py`, `/api/backup/browse` in `main.py` |
| OneDrive detection | `backend/app/main.py` `_onedrive_roots` / `_in_onedrive` / `warn_if_code_in_onedrive` |
| Upload + scientific-image previews | `main.py` `/api/lab/upload`, `backend/app/image_processor.py` |
| MCP server (unchanged) | `backend/mcp_server.py` → `backend/app/notebook_queries.py` |
| Dev entry points | `backend/run.py`, `start-dev.ps1`, `start-dev.sh`, `frontend/vite.config.ts` |
