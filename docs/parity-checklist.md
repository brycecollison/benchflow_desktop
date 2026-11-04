# Parity checklist — the web app's features, checked against the installed `Benchflow.exe`

Rule from the plan: parity is a list of the web app's features with a pass/fail against the
**installed exe on a machine with no Node and no Python** — not "the code is the same, so it
works". Any ✗ is a release blocker, and the reason goes in `CHANGELOG.md`.

Some rows are automated and green (marked **auto**); the rest need a human with
the installer on a real laptop (marked **human**). The auto rows were green on 2026-11-03
(`pytest backend\tests` plus `packaging\test_frozen.py`, which drives `dist\Benchflow\Benchflow.exe`).
Fill in the Date/Result column when you run a human row.

| # | Feature (as the web app has it) | How it is checked | Date / Result | Notes |
|---|---|---|---|---|
| 1 | Project/experiment CRUD, phases, todo, notes, attachment upload + preview | **human**: create, edit, close, reopen; thumbnails render | | The UI is the web app's own bundle, unchanged; only the way it is served changed (`/` instead of Vite), so this is the row that proves the single-origin mount works: an attachment thumbnail is an `<img>` under `/uploads`. |
| 2 | Image previews — TIFF | **auto**: `packaging/test_frozen.py` uploads a real `.tif` into the frozen exe, `POST /api/attachments/{id}/preview`, and requires a `_preview.png` on disk | | This is *the* PyInstaller failure mode (the Pillow/tifffile C-extension submodules the vendored hook hides). Green on the onedir build. |
| 3 | Image previews — ND2 | **human**: upload a real `.nd2` | | **Not verified here: no `.nd2` sample exists in either repo.** `test_frozen.py` prints what it would do if it finds one. This row needs your file. |
| 4 | XLSX/CSV viewer (`SpreadsheetViewer.tsx`) | part **auto** (an `.xlsx` uploads through the frozen exe); viewer itself **human** | | The viewer is pure TypeScript in the bundle; nothing frozen about it. |
| 5 | OneNote import (`.one`) | **human**: import the same `.one` you imported in the web app, compare experiment counts | | `aspose.note` is bundled (14 PyInstaller modules, `clrc.js`/`Python.Runtime.dll` next to it). It loads only when an import runs, so a broken bundle shows up as an error at import time, not at startup. Needs a sample `.one`. |
| 6 | Lab notebook: state save/restore, snapshots, lab images/attachments, reagent DB, `mL` template | **human**: save state, restart the app, state restored; upload an image, attach a file, take a snapshot, use the template | | `lab_state.json` sits beside the db and is written by the same code; the risk is only "did the data dir move", which Settings now shows explicitly. |
| 7 | SharePoint export — the notebook as JSON plus its referenced attachments into a SharePoint/OneDrive-synced folder (there is no `.docx` anywhere in this repo) | **auto**: `backend/tests/test_sharepoint_export.py` (what gets referenced, size limit, name sanitizing, atomic writes). **human**: Settings → Browse on the backup card opens a **native** Windows folder dialog; Cancel leaves the path unchanged. | `app/dialogs.py` registers the native dialog (the web app's iframe folder browser is not in this repo). **There is no SharePoint card in the UI** — `sharepoint_dir` is set through `PUT /api/sharepoint/config` (`docs/setup.md` has the copy-pasteable one-liner), and the export then runs on shutdown. Upstream removed that card deliberately (web repo `87e9560`, "hide SharePoint settings"), so the desktop matches the web app — but it means the feature is off unless the setting is configured by hand. |
| 8 | OneDrive online backup + shutdown backup, and the two-way sync on top of it | part **auto**: `test_backup_schedule.py` (14 kept, no writer lock in the way, refuses a network share), `test_sync.py` (the publish/pull decision table: last-matched baseline, a push refused when the folder changed, a conflict keeps both copies, an empty notebook never wipes the folder, folder paths stay local), and `test_frozen.py`'s last step (close the window → a manifest and a **newer** snapshot appear in the folder the app was told to back up to) | | Two human rows here: that the folder really is inside a synced OneDrive/SharePoint tree (so the copy reaches the cloud), and that the scheduled-task form (`Benchflow.exe --backup` while the app is open) appends to `history\`. |
| 9 | Restore from a backup folder | **auto**: `test_backup_schedule.py` (round-trip through `/api/backup/restore`) + `test_desktop_cli.py` (`--restore` refuses without `--force`, network shares, non-backup folders) | | |
| 10 | MCP tools, read-only | **auto**: `test_parity_with_web.py::test_mcp_serves_the_same_tools_as_the_web_app` compares the tool and resource names with the web repo's `mcp_server.py`, requires `READ_ONLY` annotations on every tool and `?mode=ro` + `PRAGMA query_only=ON` on the notebook; `packaging/test_frozen.py::test_frozen_build_serves_mcp_over_stdio` makes the **exe** answer `tools/list` and call a tool over stdio | | `MCP_setup.md` has the installed-exe config. |
| 11 | Preferences in localStorage (`lab_sidebar_width`, `lab_calendar_tray_open`, `lab_snap_grid`, …) | **human**: set a sidebar width, close, reopen — still there | | Two things have to hold: `private_mode=False` in `backend/desktop.py` (WebView2's InPrivate mode keeps localStorage in memory — pinned by `test_desktop_cli.py::test_the_window_keeps_its_profile_and_binds_only_to_loopback`), and the profile folder being ours at `%LOCALAPPDATA%\Benchflow\webview` instead of the default `com.frozen_app\...`. |
| 12 | Safety nets: consistency scan, "what connects to what", reagent volume validation, notebook code validation | **human** | | Same Python, same bundle; nothing frozen about them. |
| 13 | The `frontend/scripts/*-check.cjs` browser checks | **auto** against the dev server, and they can be pointed at the desktop origin (the plan's "one origin" change is what makes them pass here at all) | | `node frontend/scripts/start-dev-check.cjs` while `start-dev.ps1` runs. |

## Launch checklist (run once per release, on a clean laptop)

- [ ] Double-click launch: window appears, app icon in the taskbar, **no console window**, no browser tab. (If the taskbar shows a generic window icon instead of the Benchflow mark, note it in `CHANGELOG.md` — the window icon is set by the exe, not by the shell.)
- [ ] `python.exe` and `node.exe` appear in Task Manager's process list only as `Benchflow.exe` (no separate interpreter).
- [ ] Nothing listens beyond loopback: `netstat -ano | findstr <port>` shows `127.0.0.1:<port>` only.
- [ ] First-run import verified against a **copy** of the real data, and the web app's own data folder is byte-for-byte unchanged afterwards (`git status` in the web repo stays clean; compare file hashes).
- [ ] `Benchflow.exe --mcp` answers `tools/list` from an MCP client config.
- [ ] `Benchflow.exe --backup` runs as the scheduled task and appends to `history\` (keep 14). It publishes only - it never pulls an open window's notebook out from under it - and it exits non-zero when the guard refuses or no folder is set, so the task shows a failure instead of a silent success.

- [ ] Two laptops, one OneDrive folder: close A (it publishes), let OneDrive finish, then open B and
  close it - B now has A's work. Type on both and close one: the card says **conflict** and both
  notebooks survive (`data\benchflow-conflict-<stamp>.db`). `test_sync.py` covers the decisions;
  only a real folder proves OneDrive delivers what was copied, and only an interrupted copy proves
  the last-matched baseline is the right thing to compare against.
- [ ] Update path end to end: publish the release (tag `v<version>`, setup exe attached as an
  asset), then open an **installed older build** - it offers the new version on launch, *Download*
  produces a byte-exact file under `%LOCALAPPDATA%\Benchflow\updates\`, *Run Setup* replaces the
  program, and the notebook, uploads and settings are where they were when it reopens.
- [ ] Closing the window runs the shutdown export + backup; `history\` grows.
- [ ] Settings: the backup card gets a **native** folder dialog; Cancel leaves the configured path unchanged.
- [ ] MCP over stdio, native dialogs, the data folder, the MCP tool list and the seed copy are byte-identical to the web app: `venv\Scripts\python.exe backend\tests\test_parity_with_web.py`.
- [ ] A browser tab on another site cannot write to `/api/lab/state` (the `test_api_safety.py` cases, and once by hand).
- [ ] Uninstall leaves `%LOCALAPPDATA%\Benchflow` intact; a reinstall picks the same notebook up.
- [ ] A second launch while the window is open refuses and raises the existing window.
- [ ] Kill `Benchflow.exe` in Task Manager, then start it again — and start it once with an empty
  `%LOCALAPPDATA%\Benchflow\desktop.lock` left in place. The automated half of that is
  `test_an_empty_lock_file_does_not_wedge_startup`; the human half is watching the window actually
  open on a machine where something killed the app.
- [ ] `CHANGELOG.md` has an entry for the version, with every ✗ from the table above spelled out.
