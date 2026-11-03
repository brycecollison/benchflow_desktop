# Benchflow Desktop — Implementation Plan

A self-contained Windows **desktop build of Lab Planner & ELN** — the same app, in one
`.exe`, with its **own copy** of the data. It is a second install, **not** a replacement
of the web app: the browser version and its data folder keep working, untouched.

| | |
| --- | --- |
| The web app (source of the first copy) | `C:/Users/bryce/Desktop/Repos/Lab Planner and ELN` |
| This repo | a **complete, independent copy** of the app — backend, frontend, tests — plus desktop packaging. Forked once from the web repo, then maintained separately. |
| Path notation | `<web-repo>/...` = a path in `Lab Planner and ELN`. Anything else is relative to this repo. |

---

## 1. Goal

One installed application that:

1. Opens from the Start Menu with an icon, no terminal, no browser tab.
2. Runs the FastAPI backend and the built React UI **in one installation**, on one
   origin, with no Node or Python installed by the user.
3. Has its **own** data folder, seeded on first run by **copying** the existing
   `benchflow.db` + `uploads/` into it (one-way; the web app's files are never modified,
   moved or deleted).
4. Keeps every existing guarantee: shutdown backup to OneDrive, SharePoint export,
   read-only MCP access, restore from a backup folder.
5. Has **complete feature parity** with the web app — verified by the checklist in §8.1, not
   assumed.

## 2. Non-goals

- No auto-updater, no code signing, no Microsoft Store. Decide later.
- No macOS/Linux build in the first pass (the spec is portable; the OneDrive/`winreg`
  logic is already guarded by `OSError`).
- No rewrite of the frontend, and **no changes to the web app** — its code, its
  `backend/data`, its `backend/uploads`, `start-dev.*` and Vite proxy all stay as they are.
- No two-way sync between the web app and the desktop app (see §7 risk 1).
- No new features beyond the web app's — feature parity, not expansion.

## 3. What the web app looks like today (verified, not assumed)

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
| Dev checks | Five `frontend/scripts/*-check.cjs` drive a browser at `:5173`. Dev mode must stay intact. |

Data for the desktop build is seeded from `<web-repo>/backend/data/benchflow.db` (1.4 MB),
`<web-repo>/backend/data/lab_state.json` and `<web-repo>/backend/uploads/` (54 MB).

---

## 4. Decision

**PyInstaller (onedir) + FastAPI serving `frontend/dist` + a pywebview window
(Edge WebView2).**

One Python process: uvicorn on an ephemeral 127.0.0.1 port, `/api` and `/uploads` as
today, `"/"` serving the built React app, wrapped in a native window. WebView2 is
already installed on Windows 10/11, so no Chromium is bundled.

Most of this is packaging, not rewriting: the app is already local-first and offline, and
its code moves over intact. The work is the executable, the window, the data location, and
proving nothing broke.

Rejected, with reasons:

| Option | Why not |
| --- | --- |
| Electron | Bundles ~200 MB Chromium plus a Node shell orchestrating a Python child, for a worse result. Frontend is a Tiptap rich-text editor — the one part most sensitive to a Chromium version change. |
| Tauri v2 + sidecar | Needs a Rust toolchain and hand-written sidecar lifecycle (spawn, health-wait, kill-on-exit). pywebview already sits on WebView2, so the only gain is a smaller binary. |
| Edge/Chrome `--app` mode | Cheapest window there is, but the window is owned by the shared browser process, so you cannot reliably detect close — that silently drops `shutdown_export()` and `shutdown_backup()`, which the README promises. |
| Keep a launcher script + require Python/Node | Not self-contained; keeps the per-machine venv/wheel breakage documented in the README troubleshooting section. |

### 4.1 Two entirely separate repositories

This repo is a standalone app. It gets its **own copy** of `backend/`, `frontend/`, the
tests and the dev scripts, imported once from the web repo, and after that the two repos
do not share files, submodules or a build. Nothing here reads or writes the web repo's
source or its data folder.

One-time source snapshot (do this before any desktop work):

```powershell
cd C:\Users\bryce\Desktop\Repos\Benchflow_desktop
git -C "..\Lab Planner and ELN" archive --format=tar HEAD | tar -x   # or: robocopy, excluding venv/ node_modules/ .git/ uploads/ data/
copy-item ..\Lab Planner and ELN\backend\data\benchflow.db .\seed\   # data seed, copied not moved
```

Record the imported SHA in `UPSTREAM.md` (`vendored-from: <sha>`, date). Then get a green
baseline **in this repo, before changing anything**: `npm ci && npm run build` in
`frontend/`, `pip install -r backend/requirements.txt`, `pytest backend/tests`. That is the
reference point every later desktop failure is compared against.

What this costs, stated plainly: **two codebases.** A fix or a new feature landed in the
web app does not appear here until someone ports it. Keep it cheap:

- `UPSTREAM.md` holds the SHA. `git -C "..\Lab Planner and ELN" log --oneline <sha>..HEAD`
  lists what you have not ported; `git -C "..\Lab Planner and ELN" diff <sha>..HEAD -- backend/app/main.py`
  shows the patch to re-apply by hand.
- Keep the file layout identical to the web repo where a desktop change is not forced, so
  those diffs stay readable.
- Desktop-only files live in new places (`backend/desktop.py`, `packaging/`), never inline
  in files the web repo also edits — fewer merge conflicts.

Because the copy is ours, the awkward parts are just normal edits in this repo: mount
`dist/`, tighten CORS, replace the tkinter dialog. No monkeypatching, no pull requests
into the web repo, no version pinning between the two.

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

%LOCALAPPDATA%\Benchflow\        ← the desktop app's OWN data; the web app's tree is
  ├─ data/benchflow.db, lab_state.json    never opened for writing
  ├─ uploads/
  └─ webview/            WebView2 profile
<install dir>\           read-only; frontend/dist lives in sys._MEIPASS
OneDrive\BenchflowBackup\        ← its own snapshot folder, separate from the web app's
```

MCP clients keep reading the SQLite file directly: `Benchflow.exe --mcp` with
`BENCHFLOW_DB_PATH=%LOCALAPPDATA%\Benchflow\data\benchflow.db`.


## 6. Phases

Every phase lands green on its own and leaves this repo's dev mode working. Effort is for
one developer; total ≈ 5 working days after the source snapshot (§4.1, 2 h), and Phase 2 is
the only genuinely uncertain part.

### Phase 0 — Single origin, no Vite at runtime (½ day) — do this first

**Files:** `backend/app/main.py` (this repo's copy)

1. After the `/uploads` mount and after all routes, add
   `app.mount("/", StaticFiles(directory=<dist>, html=True))`. Mount it **last** so
   `/api` and `/uploads` keep precedence. No SPA fallback route (no router).
2. Resolve `dist` from a module-level constant that Phase 2 will switch to `sys._MEIPASS`;
   in dev it is `<this repo>/frontend/dist`.
3. Keep `frontend/vite.config.ts` and `start-dev.*` working — they are how this repo is
   developed. The web repo has its own copies; neither knows about the other.

**Acceptance:** `npm --prefix frontend run build`, then `python run.py`, then
`http://127.0.0.1:8000/` is the whole app — navigate every view, save state, upload a
file, open a preview image. `start-dev.ps1` still works and the five
`frontend/scripts/*-check.cjs` browser checks still pass against `:5173`.

**Frontend changes: none.** Relative paths now hit the same origin.

### Phase 1 — Copy the data in (2 h) — do it early; it is the only phase that touches real data

**Files:** new `backend/app/seed.py`, `backend/app/paths.py`, `README.md`

Defaults in this repo's `paths.py`: `DATA_DIR = %LOCALAPPDATA%\Benchflow\data`,
`UPLOAD_DIR = %LOCALAPPDATA%\Benchflow\uploads` (env-var overrides still win, so a
developer can point this build at any folder). `BASE_DIR` must not be a data root once
frozen (`paths.py:12` = `Path(__file__).parent.parent` lands inside the read-only bundle);
add `APP_ROOT` = `sys._MEIPASS` when frozen, else this repo's `backend/`.

Seeding, on first launch before `init_db()`:

1. If the desktop db does not exist, copy `benchflow.db`, `lab_state.json` and all of
   `uploads/` in. Source, in order: a folder the user picks in the first-run dialog
   (prefilled with `<web-repo>/backend/` if that path still exists on this machine), or
   `Benchflow.exe --import <dir>` for scripting. Ask once; never guess a path.
2. **Copy, never move.** The web app's `backend/data` and `backend/uploads` are opened
   read-only and left exactly as found. Do not rename, delete or "clean up" them.
3. Never overwrite an existing desktop file. If the desktop db already exists, seeding does
   not run — later imports go through an explicit `--import <dir>` that writes to a new
   `benchflow-imported-<timestamp>.db` and tells the user, rather than merging rows.
4. `uploads/` paths are stored relative to `UPLOAD_DIR`, so a copied tree resolves as-is —
   no path rewriting in the db.

**Acceptance:** run the seed against a **copy** of the real web data (54 MB, the actual
notebook) and assert project/experiment counts, that every attachment resolves under
`/uploads/...`, and that a preview image opens. Then run restore
(`Settings → Personal OneDrive Backup`) against a previous snapshot. **Nothing here is
reversible for the desktop copy until these two pass.**

### Phase 2 — Freeze the backend (1–2 days, the risky phase)

**Files:** new `packaging/benchflow.spec`, new `backend/desktop.py` (entry point),
`backend/requirements.txt` (add `pyinstaller` under a dev-only section)

1. `desktop.py`: strip `reload=True` from the uvicorn path (`run.py` stays as this repo's
   dev entry). Pick a free port with the bind-socket-0 trick, start uvicorn in a thread,
   poll `/api/health` until it answers, then open the window. Keep binding **127.0.0.1**.
2. `benchflow.spec`: **onedir** (not onefile — onefile re-extracts 250 MB on every launch
   and will look like a hang). `contents_collection` for `frontend/dist`.
   Hidden imports / `collect_submodules` for: `aspose.note`, `tifffile`, `nd2`,
   `imagecodecs`, `skimage` bits pulled by `image_processor.py`, `winreg`. Exclude `pip`,
   `pywin32`'s `pythonwin`, `pywin32_system32`
   leftovers, `pytest`, the `tests/` tree, and `tkinter` (Phase 3 deletes the only file
   that imports it, `app/folder_picker.py`).
3. `backend/app/image_processor.py` must be exercised from inside the frozen build —
   `tifffile`/`nd2`/`imagecodecs` load binary plugins and are the usual PyInstaller
   failure here.

**Acceptance:** a new small test, `packaging/test_frozen.py` (self-check style, like
`backend/tests/test_backup.py`): launch the built exe headless, poll `/api/health`,
assert `GET /` returns the built `index.html`, `POST /api/lab/upload` a real `.tif` and
a real `.nd2` from `backend/uploads/` and assert a `_preview.png` comes back, then kill
the process and assert the shutdown snapshot ran. Unpacked size expectation 150–250 MB.

### Phase 3 — The window (1 day)

**Files:** `backend/desktop.py`, `backend/app/main.py` (`/api/backup/browse`); delete this repo's
`backend/app/folder_picker.py` + `backend/tests/test_folder_picker.py`

1. `webview.create_window("Benchflow", url, width, height)` + `webview.start()`.
   Set `WEBVIEW2_USER_DATA_FOLDER=%LOCALAPPDATA%\Benchflow\webview` **before** import,
   so the existing localStorage keys (`lab_sidebar_width`, `lab_calendar_tray_open`,
   `lab_snap_grid`, …) persist across restarts instead of resetting every launch.
2. On the window close event: signal the uvicorn thread to stop and wait for it, so the
   existing `lifespan` shutdown runs `shutdown_export()` and `shutdown_backup()` exactly
   as the dev launcher does today. Also install a `SIGTERM` handler.
3. Replace the folder dialog: `/api/backup/browse` calls a pywebview
   `create_file_dialog(webview.FOLDER_CHOOSER)` instead of the tkinter subprocess (there is
   no usable `sys.executable` in a frozen app, so the shipped `folder_picker.py` cannot
   work). Keep the existing 503 fallback message for when the dialog is unavailable, and
   keep the manual path entry in Settings.
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

`backend/app/backup.py` keeps its own CLI for this repo's dev flow; `--backup` is a thin
wrapper over `backup_run()` in `main.py` so the scheduled task records the same "last
backup" the Settings card shows. `mcp_server.py` itself does not change.

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
WebView2: install → launch → first-run import pulls in the copied notebook → upload →
backup → restart → the MCP client reads it.

---

## 7. Risks, ranked

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **The copied notebook drifts from the web app's.** Two installs, two databases; an edit in one is invisible to the other, and the user will not notice until a month of notes is in the wrong place | Be explicit in the UI and the README about which notebook the desktop app owns. Seeding is one-way and asked-for; a later `--import` writes a *new* db and says so rather than merging rows. Decide the source of truth (open question 1). |
| 1b | **The codebases drift too** (separate repos, by design) | `UPSTREAM.md` records the vendored SHA; `git log/diff <sha>..HEAD` in the web repo is the porting queue. Do the desktop-only work in new files so those diffs stay readable. |
| 2 | **PyInstaller + `imagecodecs`/`tifffile`/`nd2` binary plugins fail inside `_MEIPASS`** — TIFF/ND2 preview generation and OneNote import die silently | `packaging/test_frozen.py` uploads real `.tif`, `.nd2`, `.xlsx` from `uploads/` and asserts previews. Fix it in the spec (`collect_submodules`, `collect_data_files`, `copy_metadata` for the dist-info `imagecodecs`/`tifffile` need); **do not** solve it by deleting the feature — that breaks the parity requirement. Expect this phase to take the extra day. |
| 3 | **WebView2 runtime missing** on an older machine → blank window | Probe the Evergreen/Flat RC registry key at startup; if absent, print the URL and open the default browser instead of showing a dead window. |
| 4 | **Two instances writing one SQLite file** | Single-instance lock (Phase 3). MCP stays read-only. |
| 5 | Live db left in a OneDrive-synced folder → online-only placeholders and `benchflow-DESKTOP-ABC.db` conflict copies | Data defaults to `%LOCALAPPDATA%`; keep `warn_if_code_in_onedrive()` and keep the snapshot as the only thing that travels. Do **not** switch to WAL — `TRUNCATE`+`synchronous=FULL` in `app/database.py` is deliberate. |
| 6 | Free-port change silently breaks something hard-coding 8000 | MCP reads the db file, not HTTP, so it is unaffected; this repo's dev keeps 8000. Grep for `8000` before shipping. |
| 7 | Bundle is large (150–250 MB unpacked) | Accept it. If it matters, the big wins are `dask` (17 M), `cryptography` (11 M) and pywin32's `pythonwin` (5 M) — all droppable without touching app code. |

---

## 8. Feature parity and definition of done

### 8.1 Feature parity checklist

Parity is a list of the web app's features with a pass/fail against the **installed**
`.exe` — not "the code is the same, so it works". Every row is run once on a machine with
no Node or Python. Any ✗ is a release blocker; the reason is recorded in `CHANGELOG.md`.

| Feature (web app) | Where it lives | Desktop check against the installed exe |
| --- | --- | --- |
| Project/experiment CRUD, phases, todo, notes, attachments upload + preview | `app/main.py`, `Attachments.tsx`, `CodeViewer.tsx` | Create, edit, reload, still there; attachment thumbnails render |
| Image previews (TIFF, ND2, microcopy) | `app/image_processor.py`, `/uploads` mount | Upload a real `.nd2` and `.tif` → `_preview.png` exists (this is the PyInstaller failure mode, so it is tested here) |
| XLSX/CSV viewer | `SpreadsheetViewer.tsx`, `parse-spreadsheet.ts` | Open a real xlsx from `uploads/` |
| OneNote import (.one) | `app/onenote_importer.py` | Import the same `.one` file as the web app, compare experiment counts |
| Lab notebook: save/restore, snapshots, attachments, reagent DB, template | `app/lab_state.py`, `app/lab_images.py`, `app/lab_attachments.py`, `app/reagents.py`, `app/lab_units.py`, `LabNotebookView.tsx` | Save state, restart, state restored; image upload + attachment + snapshot + the `mL` template all work |
| SharePoint (.docx) export | `app/sharepoint_export.py`, `winreg` OneDrive detect | Settings → Browse gives a **native** dialog; export lands in the chosen folder; Cancel leaves the path unchanged |
| OneDrive online backup + shutdown backup | `app/backup.py`, `main.py:432` | Scheduled `--backup` appends to `history/` (keep 14); closing the window also appends |
| Restore from a backup folder | `/api/backup/restore` | Restore an older snapshot, notebook matches |
| MCP tools, read-only | `mcp_server.py` | `Benchflow.exe --mcp` answers `tools/list` + `tools/call` from an MCP client config |
| Prefs in localStorage (`lab_sidebar_width`, `lab_calendar_tray_open`, `lab_snap_grid`, …) | frontend store | Restart the app → width/tray/grid settings kept (needs the WebView2 profile dir) |
| Safety nets | `app/consistency.py`, `app/mcp_safety.py`, `lab_units` validation, `lab_state` code validation | Consistency scan, "what connects to what", reagent volume input all behave |

The five `frontend/scripts/*-check.cjs` scripts copied into this repo are the fast
regression net: point them at the desktop dev port during development, and at least run
them once against the built app.

### 8.2 Launch checklist

- [ ] Double-click launch: window, app icon in the taskbar, no console, no browser tab.
- [ ] No Node or Python on the target machine; `npm` and `venv` are build-time only.
- [ ] First-run import verified against a copy of the real data; the web app's own data
      folder is byte-for-byte unchanged afterwards.
- [ ] Every row of §8.1 passes against the installed exe.
- [ ] Upload → TIFF/ND2 preview works in the frozen build (`test_frozen.py` green).
- [ ] Closing the window runs the shutdown export + backup; `history/` grows.
- [ ] `Benchflow.exe --mcp` serves the same tools as the web repo's `mcp_server.py`; `MCP_setup.md` updated.
- [ ] `Benchflow.exe --backup` works as the scheduled task.
- [ ] Settings backup / SharePoint cards work with the native folder dialog; Cancel
      leaves the configured path unchanged.
- [ ] Foreign-origin writes to `/api/lab/state` are rejected; `test_api.py` passes.
- [ ] This repo's dev flow works: `start-dev.ps1`, `python run.py`, the five
      `*-check.cjs` scripts, `pytest`.

## 9. Open questions — answer before Phase 5

1. **Which notebook is the source of truth now?** Two installs, two databases. Is the
   desktop app the one you use daily (and the web app becomes a fallback / demo), or the
   other way round? Nothing else in the plan changes, but the user-facing copy in Settings
   and the README has to say it, or notes land in the wrong app.
2. **Keep the browser as a client** (multi-device / remote access)? If yes, Phase 5's
   session token stops being optional and the app needs real auth.
3. **Bundle size** — `aspose-note-foss` + the 958-line `app/onenote_importer.py` and the
   imaging stack dominate it. Parity says they stay; if size ever becomes a problem, they
   are the first things to negotiate away, and that is a product decision, not a packaging
   one.
4. **Sign the binary?** Unsigned means a SmartScreen prompt on every new build.

## 10. Build order

```
source snapshot (§4.1, green in this repo)
        |
        v
0 single-origin ──> 2 PyInstaller ──> 3 window ──> 4 modes ──> 6 installer
        |                                        \
        +--> 1 copy data in -----------------------> 5 API hardening
```

Nothing starts until the snapshot builds and tests green in this repo. Phase 1 may run in
parallel with Phase 2, but must be verified before a build is installed on the machine that
holds the real data. Phase 5 is one hour and can fold into Phase 0 — never skipped.

## Appendix — anchors in the code

The snapshot copies these files into this repo, so the line numbers below apply to both
until the two diverge.

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
