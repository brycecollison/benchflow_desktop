# Benchflow

Benchflow is a lab planner and Electronic Lab Notebook (ELN) for life science research: projects,
publications, experiment dependencies, scheduled workflow phases and experimental records in one
application.

This repository is the **Windows desktop app**. One program you install and double-click - no Node,
no Python, no Docker, no browser tab at runtime. Your notebook is a SQLite file on your own disk:
no account, no server, nothing uploaded anywhere. Built with React 19 + TypeScript + Vite (shipped
as a bundle inside the app), FastAPI + SQLModel serving it, SQLite for storage, WebView2 for the
window, PyInstaller + Inno Setup for the installer.

It is a port of the Benchflow web app and does not sync with it: see
[Relationship to the web app](#relationship-to-the-web-app).

The repo also holds the in-progress **Android companion** (`mobile/`) and the desktop end of its sync (`backend/app/mobile_sync/`, design in
`docs/adr/0002-mobile-sync.md`).

## Install and run

Windows 10 or 11, 64-bit, with the **WebView2 Runtime** (already present on current Windows, it
ships with Edge). No administrator rights needed.

Run `Benchflow-<version>-Setup.exe`. It installs per-user:

| What | Where |
| --- | --- |
| Program | `%LOCALAPPDATA%\Programs\Benchflow` |
| Notebook, uploads, WebView2 profile | `%LOCALAPPDATA%\Benchflow` |
| Logs | `%LOCALAPPDATA%\Benchflow\logs\backend.log` |

Uninstalling leaves the notebook alone, so reinstalling finds your work where you left it. Start it
from the Start menu or by double-clicking `Benchflow`. Only one window at a time: a second launch
raises the open one instead of starting a second server. On first run it asks whether to copy an
existing notebook in - see [Moving a notebook in from the web app](#moving-a-notebook-in-from-the-web-app).

The web server runs inside the same process, on 127.0.0.1 on a free port. Nothing listens on a
fixed port and nothing is reachable from other machines. There is no login, because there is no
server to log in to: whoever can open the window can read the notebook.

### Command line modes

`Benchflow.exe --help` prints these, plus the data and log paths for that install.

| Mode | What it does |
| --- | --- |
| *(no arguments)* | Open the window. The only mode that does. |
| `--import DIR` | Copy an existing notebook into this install and exit. `DIR` is the web app's `backend` folder (`data\` + `uploads\`), or any folder containing `data\benchflow.db`. |
| `--backup` | Match the backup folder set in Settings and publish this notebook into it, then exit. Refuses with an error when the folder holds a notebook this machine has not matched - a full sync needs the window closed. |
| `--restore [DIR]` | Copy a snapshot back into this install and exit. `DIR` defaults to the configured backup folder. Close the window first. |
| `--mcp` | Serve the read-only notebook tools over stdio and exit: no window, no web server, nothing written. |
| `--debug` | Open the window with WebView2 devtools attached. |
| `--version` | Print the version and exit. |

`--import` and `--restore` refuse to overwrite a notebook that holds records; `--force` replaces it
and keeps what was there.

## Moving a notebook in from the web app

The desktop app and the web app each own **their own notebook**. There is no sync and no shared
file: the web app's folder is read once, at import, and never written back.

| Install | Notebook | Attachments |
| --- | --- | --- |
| Web app | `<web repo>\backend\data\benchflow.db` | `<web repo>\backend\uploads\` |
| Desktop app | `%LOCALAPPDATA%\Benchflow\data\benchflow.db` | `%LOCALAPPDATA%\Benchflow\uploads\` |

A development run of this repo (`backend\run.py`, `backend\desktop.py`) uses the desktop paths, not
`backend\data` - that is the web app's layout.

**Decide which notebook is authoritative before importing.** An import writes a *new* notebook, it
does not merge rows: if both apps have edits, only the folder you point at arrives.

### First run asks once

Before it writes anything, a fresh install asks *Copy an existing Benchflow notebook in now?*

1. **Yes** opens a folder picker. Choose the web app's `backend` folder - the one holding `data\`
   and `uploads\`. Any folder with `data\benchflow.db` in it works. The picker starts in the
   notebook bundled with the build (`seed\`), so accepting the default imports that bundled copy
   instead - pick the web app's folder explicitly.
2. **No** starts an empty notebook, which you can fill in later.

The app never asks twice. After that, importing is always a deliberate act from a terminal.

### Import later, from a terminal

Copy the web app's `backend` folder onto a local disk first (the app refuses to read a notebook
straight off a network share), close the Benchflow window, then:

```powershell
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe" --import "C:\Users\you\Desktop\web-backend-copy"
```

It prints what came over: experiments, attachments, database size. A notebook that already exists is
never touched - the copy lands beside it as `benchflow-imported-<timestamp>.db` and the run says
so. To make it the live notebook instead, add `--force`: the notebook it replaces is kept as
`benchflow-replaced-<timestamp>.db` plus `uploads-replaced-<timestamp>`, and `--force` still refuses
outright when that notebook holds records. So the only way to lose work is to move the old file away
yourself. From a development checkout, the same command is
`venv\Scripts\python.exe backend\desktop.py --import "..."`.

### What arrives

- **`benchflow.db`**, read through SQLite's online-backup API - the web app may still be running on
  it, and a torn byte-for-byte copy cannot happen.
- **`lab_state.json`**, if this install does not already have one.
- **Everything in `uploads\`**, subfolders kept, so the attachment names already in the database
  resolve without rewriting any path.
- Records whose name is empty get their project's name filled in. That is the only change made in
  transit, and it is there because the sidebar otherwise has nothing to show.

Nothing in the source is renamed, deleted or cleaned up. To see which files an install reads, open
**Settings → This app's notebook**: it prints both paths.

After the import the two installs stay independent - an edit in the web app the next day is
invisible here. Pick one app to write in, and use the backup below to carry that notebook between
machines.

## Setting up the OneDrive backup folder

The folder is a two-way postbox, not just a dump: closing a window **publishes** this machine's
notebook into it, and opening a window on any machine **takes** the notebook from it. The live
notebook always stays on local disk - only the copy in the folder travels. Two machines working at
the same time: the one closed later wins, and nothing is ever merged.

### Choose the folder

1. Open **Settings → Personal OneDrive Backup**.
2. Click **Browse** beside **Backup folder path**, or type the path. Use a folder inside your
   *personal* OneDrive (e.g. `C:\Users\you\OneDrive\BenchflowBackup`); a folder name that does not
   exist yet is fine, it gets created. Cancelling the picker leaves the path unchanged.
3. Click **Save** - that stores the path and takes the first backup immediately. Selecting a folder
   without saving changes nothing.
4. Click **Back up now** for another snapshot whenever you want one.

The native picker opens on the machine running the app and needs a desktop session; if it will not
open, type the path instead. A folder outside OneDrive is accepted but warned about, because nothing
then syncs to the cloud. A folder inside the code folder is rejected.

### What the folder holds

```text
<backup folder>/benchflow.db                          the notebook the last machine published
<backup folder>/history/benchflow-YYYYMMDD-HHMMSS.db    the newest 14 snapshots of it
<backup folder>/uploads/...                            attachments your content points at
<backup folder>/manifest.json                          last run: counts, sizes, unreferenced names
```

Next to the live database (not in the folder) sits `benchflow-sync.json`: the fingerprint this
machine last matched its notebook with the folder's, and the last pull result. It is what makes "did
the other computer change this?" answerable.

- Snapshots come from SQLite's online-backup API, so the sync client never sees a half-written
  database. Running a backup while the window is open is safe - it is a backup, not a file copy.
- Only attachments that notebook content actually references are copied. Files nothing points at are
  listed in `manifest.json` as `unreferenced` (name and size) and left out - on a real notebook that
  is the difference between roughly 0.1 GB and 1.1 GB of quota.
- The mirror **never deletes**. Removing a file in the app cannot empty the cloud copy; prune the
  folder by hand when quota matters.

### When backups run

| When | |
| --- | --- |
| **Opening the window** | pulls first, before anything else opens the notebook |
| **Save** in Settings, or **Back up now** | immediately |
| Closing the window | every time, if a folder is set |
| Window left open | every 8 hours |
| `Benchflow.exe --backup` | on a schedule, e.g. `schtasks /Create /TN Benchflow-Backup /SC DAILY /ST 18:30 /TR "\"%LOCALAPPDATA%\Programs\Benchflow\Benchflow.exe\" --backup"` |

The Settings card reports the folder state (found / not found, inside OneDrive or not), the last
run (database size, attachments copied, how many were new, snapshot count and timestamp) and the
sync state: when this machine last matched the folder, and whether a pull was skipped for a
conflict (with the file that was kept instead).

A push is refused when the folder holds a notebook this machine has not matched - a window left open
while the other machine published, or a machine that has never synced. Nothing is overwritten: that
window's work still goes into `history/` and `uploads/`, and the card says to close and reopen the
window, which either pulls or reports a conflict.

Use **one computer at a time**, and wait for OneDrive to finish before switching. OneDrive is
asynchronous: the guard sees only this machine's local copy, so it cannot prevent simultaneous
writes from two offline computers. This is notebook handoff, not live collaboration.

### Getting the notebook onto another machine

Publish on the first machine (close its window), let OneDrive finish syncing, then on the second
machine open **Settings → Personal OneDrive Backup**, point it at the same folder and save, and
close and reopen the window. An empty notebook takes the folder's notebook. An existing notebook
that has never synced is treated as a conflict, not silently replaced. On later pulls, the previous
notebook is preserved as `%LOCALAPPDATA%\Benchflow\data\benchflow-replaced-<stamp>.db`.
Missing remote attachments postpone a pull; different attachment contents under the same name
stop the copy rather than overwrite either file.

If **both** machines have typed since they last matched, neither overwrites the other: the folder's
notebook is copied to `data\benchflow-conflict-<stamp>.db` (with its attachments), the card says so,
and you decide - publish from one machine, or restore the kept copy by hand:

```powershell
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe" --restore "C:\Users\you\OneDrive\BenchflowBackup"
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe" --restore    # the folder already set in Settings
```

`--restore` stays the manual route: it needs an empty live notebook (it refuses otherwise and changes
nothing), and it brings back the database plus the uploads the notebook references. A brand new
install has no notebook yet, so it has no configured folder to read - give it the path.

### Keep the live data and the code out of OneDrive

Only the backup folder belongs in the synced tree:

- A **live** SQLite file in a synced folder gets replaced by an online-only placeholder the app
  cannot open, and two machines writing the same path produce `benchflow-DESKTOP-ABC.db` conflict
  copies that become two diverging notebooks. That is why the live data stays local and the snapshot
  is what travels.
- A **repository** inside OneDrive drags `.git` and machine-built `venv` wheels between machines.
  The app logs a warning when it starts in that state, and rejects a backup destination inside the
  code folder. Clone the repo fresh on each machine instead of dragging the folder across.

## Updating the app

A new build arrives as `Benchflow-<version>-Setup.exe`. Installing it over an older one replaces the
program only: the notebook, uploads, logs, settings and the backup folder setting all stay where
they are, and the installer never goes near the OneDrive folder.

An installed build asks GitHub for the newest release when a window opens - once per window, and not
at all for a source checkout or the web app, which have no installer to run. When there is a newer
one, a card appears in the corner of the window:

1. **Download installer** puts it in `%LOCALAPPDATA%\Benchflow\updates\` and shows how far it got.
   Nothing else changes, so it is safe to leave running while you keep working. About 65 MB: start
   it while the network is good, and the card's *Later* leaves it for another time.
2. **Run Setup** starts that installer and asks to close Benchflow. Let it close the window - that is
   the step that saves this notebook to the sync folder. Accept Setup's own "close the applications"
   prompt rather than killing the process: a killed Benchflow skips that save.
3. Open Benchflow again. `Benchflow.exe --version` prints the build you are on, and
   **Settings → Updates** says whether this install is up to date.

Closed the card too early? **Settings → Updates** has the same buttons, and **Check now** asks GitHub
again immediately instead of waiting for the next window.

Two computers: update both before continuing to share a notebook. Current migrations add missing
tables and selected experiment columns, but that is not a guarantee of compatibility with older
builds. Read the [Changelog](#changelog) for release-specific migration instructions.

## Where the app keeps its files

| | Installed app | Development checkout |
| --- | --- | --- |
| Notebook | `%LOCALAPPDATA%\Benchflow\data\benchflow.db` | same |
| State snapshot | `%LOCALAPPDATA%\Benchflow\data\lab_state.json` | same |
| Attachments | `%LOCALAPPDATA%\Benchflow\uploads\` | same |
| Logs | `%LOCALAPPDATA%\Benchflow\logs\backend.log` (+ `.1`, `.2`) | same |
| Instance lock, WebView2 profile | `%LOCALAPPDATA%\Benchflow\` | same |
| Downloaded installer | `%LOCALAPPDATA%\Benchflow\updates\` | not used - a checkout has no installer to replace |
| Code only | `%LOCALAPPDATA%\Programs\Benchflow` | the repo folder |

- The journal runs in SQLite TRUNCATE mode, not WAL, so a cloud-synced `-wal` can never end up
  paired with a different moment of the main file; a 0-byte `benchflow.db-journal` beside it is
  normal.
- `lab_state.json` is a secondary snapshot written on state saves and used to seed an empty
  database. It is not the primary store once SQLite contains data.
- The UI does **not** fall back to browser local storage. If the API stops answering it shows an
  error banner, because `POST /api/lab/state` replaces the whole database and an empty or stale
  local copy would delete projects and experiments.
- To run against an isolated notebook instead of your real one, set `BENCHFLOW_DATA_DIR` (moves the
  notebook, and uploads and logs beside it), or `BENCHFLOW_UPLOAD_DIR` / `BENCHFLOW_LOG_DIR` /
  `BENCHFLOW_APP_DATA` to move one of them alone. `backend/app/paths.py` resolves all of it.
- The notebook and uploads are never inside the install folder, which is read-only to a normal user,
  and never inside the repo. A notebook in a source checkout is git-ignored.

## What the notebook does

The application is the same one the web app runs, so the feature set is identical.

### Planning and navigation

- **Calendar:** the default view, with scheduled experiment phases and responsive week-view cards.
- **Gantt:** an all-projects timeline followed by a chart for each active project. Charts open at
  today, retain earlier phases to the left, show experiment names beside or inside phase bars, and
  offer Days/Weeks scales and Today buttons. Completed and unscheduled phases are hidden; clicking a
  bar opens its experiment.
- **Project flowcharts:** draggable experiment nodes, automatic dependency layout, cycle prevention,
  connection editing, optional grid snapping.
- **Project and paper overviews:** organize experiments by project or publication, assign multiple
  papers to projects, archive or restore projects and papers.
- **Search and filters:** by status, priority and paper, including include/exclude modes. Gantt also
  offers project selection and experiment search.
- **Light and dark themes**, expandable navigation and context sidebars.

### Continuous full-screen experiment editor

Open an experiment, then click **Full Screen** in its popup.

- Included sections appear together in one continuous scrollable document: Purpose, Expected
  Results, Experimental Design, Experimental Protocol, Data Acquisition, Data Analysis, Results,
  Notes. Workflow phases removed from the experiment stay excluded until added back.
- Each section starts with a header and ends with a horizontal rule. Attachment previews appear
  after the text; the upload controls sit below those previews and above the ending rule.
- Rich-text controls include headings, bold, italic, underline, strikethrough, lists, quotes, code,
  links, tables, undo/redo. **Tab** indents inside the text editor, **Shift+Tab** outdents; list
  items support nesting. Those keys keep normal focus-navigation behaviour outside the editor.
- Changes autosave. Rich text is stored as Markdown, so the popup and exports retain readable
  content.
- **Esc** closes the image inspector first, exits full-screen mode next, or closes the regular
  popup. Dismissing an in-page prompt does not also exit the editor.

### Attachments and screenshot pasting

- Click **Insert image** in a section's formatting toolbar, drag an image into its text, or paste a
  screenshot with **Ctrl+V**.
- Pasted screenshots upload automatically and appear inline. The image is also recorded in that
  section's attachment area and remains available after reloading.
- Each section supports multiple-file uploads, image thumbnails and inspection, CSV/TSV previews,
  video/audio controls, text notes and downloadable document cards. Files without an inline preview
  stay downloadable.
- TIFF and Nikon ND2 support includes scientific metadata and generated web previews where
  conversion succeeds.
- Attachments belong to the experiment and section, with workflow-phase ownership for Protocol,
  Acquisition and Analysis sections. Legacy attachments without ownership appear under Results.
- Removing an attachment card does not delete the original file from disk. Removing an inline image
  from the text does not automatically remove its attachment card.
- Uploads are written to this install's `uploads\` folder by the app itself - there is no cloud
  storage step to fail. A failed upload reports an error rather than silently substituting an
  unsaved local image.

## Read-only agent access

An MCP server exposes the notebook to MCP clients and coding agents (Claude Desktop, Codex CLI,
LM Studio, Cursor, pi): find experiments, read section text, table cells and attachment metadata.
It is **read-only** - there are no tools to create, edit, complete, delete, import, upload,
schedule or run experiments, and every database connection is opened with `mode=ro` plus
`PRAGMA query_only`.

| Tool | Behaviour |
| --- | --- |
| `list_projects` | Projects with experiment counts; archived hidden unless `include_archived` |
| `search_experiments` | Ranked keyword search over active sections; filters: project, section, status, archived; pagination |
| `get_experiment` | One record: sections, phase state, dependencies, papers, attachment metadata, record and retrieval time |

Four resources are available too: `benchflow://projects`, `benchflow://projects/{id}`,
`benchflow://experiments/{id}` and `benchflow://experiments/{id}/sections/{section_key}`. Valid
section keys are `purpose`, `expectedResults`, `experimentalDesign`, `experimentalProtocol`,
`dataAcquisition`, `dataAnalysis`, `results`, `notes`, plus each record's custom phase ids.

From an installed build, point the client at the executable - there is no Python to point at:

```json
{
  "mcpServers": {
    "benchflow": {
      "command": "C:\Users\you\AppData\Local\Programs\Benchflow\Benchflow.exe",
      "args": ["--mcp"]
    }
  }
}
```

From a development checkout, use `venv\Scripts\python.exe backend\mcp_server.py` instead. Either way
the notebook served is that install's (`%LOCALAPPDATA%\Benchflow\data\benchflow.db`), unless
`BENCHFLOW_DB_PATH` points elsewhere - point it at a copy of the database to keep an agent away from
the live notebook. A missing notebook file is a clear tool error; the server never creates, migrates
or seeds one. Starting the server needs no window open.

Attachment **metadata** is visible (name, type, format, dimensions, ND2/TIFF scientific fields,
table cell previews); attachment **contents** are not served and no `uploads\` path is returned.
Search is literal, case-insensitive substring matching over names and section text - all terms must
match; there is no fuzzy, semantic or image search. `mcp_integration_planning.md` records the
design and open questions; `MCP_setup.md` walks through a working client setup.

## Developing this app

Prerequisites: **Windows**, **Node.js 22.12+** (or the supported Node 20 line at 20.19+) and npm,
**Python 3.12+**. For packaging: **Inno Setup 6** (`ISCC.exe`). Some checks run `.ts` files
directly, which needs Node 22.18+ or 24.

```powershell
py -3 -m venv venv
venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend ci
```

Three ways to run it:

| Command | What you get |
| --- | --- |
| `venv\Scripts\python.exe backend\desktop.py` | The real thing: one process, API on a free port, WebView2 window. Add `--debug` for devtools. |
| `venv\Scripts\python.exe backend\run.py` | API only on http://127.0.0.1:8000 with auto-reload, serving `frontend\dist` - so run `npm --prefix frontend run build` first. |
| `.\start-dev.ps1` | Vite dev server with hot reload on http://localhost:5173 plus the auto-reloading API on 8000, the way the web repo develops. |

All three read and write `%LOCALAPPDATA%\Benchflow`, not the repo. Set `BENCHFLOW_DATA_DIR` to a
temporary folder when you want a throwaway notebook - several checks do exactly that.

Data-analysis pages: http://127.0.0.1:8000/docs is the interactive API documentation (dev run).

### Checks

```powershell
venv\Scripts\python.exe -m pytest backend\tests -q      # paths, seed, backup, sync, update, scheduler, folder picker
venv\Scripts\python.exe backend\tests\test_parity_with_web.py   # this tree vs the web app it came from
node frontend\scripts\start-dev-check.cjs              # launcher behaviour
node frontend\scripts\backup-browse-check.cjs          # Settings backup card + picker
node frontend\scripts\phases-check.ts                  # phase rules
node frontend\scripts\lab-sync-check.ts                # window side of phone sync (baselines, polling)
node frontend\scripts\gantt-check.ts                   # Gantt geometry
```

`frontend\scripts\` holds the rest, including Playwright browser checks that need a resolvable
Playwright and an installed Google Chrome; install the test tool without touching the manifests:
`npm --prefix frontend install --no-save --package-lock=false playwright`. The three backend scripts at
`backend\test_api.py`, `backend\test_mcp.py` and `backend\test_section_attachments.py` are plain
scripts: run them as `venv\Scripts\python.exe backend\test_api.py` from the repo root, not through
pytest (pytest asks for a fixture those scripts create themselves). Each one builds a throwaway
notebook in a temporary folder.

`backend\tests\test_parity_with_web.py` compares this tree against the web app it was copied from.
It skips when that checkout is not available; point it at one with `BENCHFLOW_WEB_REPO`, or put the
web repo next to this one at the path recorded in `UPSTREAM.md`.

### Building the installer

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build.ps1
```

That builds the UI, then `dist\Benchflow\Benchflow.exe`, then checks the result with
`packaging\test_frozen.py` (frozen imports, data paths, the first-run seed landing, a real `.tif`
upload and preview, and the exe's own `--mcp` tool list) and stops there if that fails. The
installer comes out at `dist\installer\Benchflow-<version>-Setup.exe` (Inno Setup 6 must be
installed), and a portable build at `dist\Benchflow-<version>-windows-portable.zip`. Flags:
`-SkipTest`, `-SkipInstaller`, `-Seed`.
`docs/setup.md` has the full procedure, including where `APP_VERSION` lives and how the version is
stamped into the exe and every backup manifest.

To release what you built: bump `APP_VERSION`, commit, tag that commit `v<version>`, and publish the
tag on GitHub with `dist\installer\Benchflow-<version>-Setup.exe` as an asset. That tag is what
installed builds compare against, and the asset name is what they download, so both have to match
`APP_VERSION` - the tag may start with `v`, the asset name may not, because the version in it has to
be digits. A release with no matching asset is announced without an installer, and the app says
so instead of failing. The portable zip can go next to it for anyone who does not want an installer.

## Troubleshooting

**The window opens but shows an error banner instead of records.** The API inside the process did
not start or died. Open `%LOCALAPPDATA%\Benchflow\logs\backend.log` - it holds the last lines of
both, and the app is designed so that this file is enough to diagnose a crash. Then relaunch with
`--debug` to inspect the window itself.

**A second launch does nothing visible.** That is intended: it raises the already-open window. If no
window is visible anywhere, look for `Benchflow.exe` in Task Manager and end it, then start again -
a live process holds the instance lock, and a dead one is detected by a health check.

**Backups are not appearing in the folder.** The path has to be saved in Settings, not only picked;
the Settings card then reports the folder state and the last run. `manifest.json` in the backup
folder says what the last run copied. A backup never deletes, so a folder that stopped receiving
files still shows the old ones.

**Nothing was imported.** `--import` wants the folder that contains `data\benchflow.db` (the web
app's `backend` folder), it refuses to read a notebook over a network share, and an existing
notebook is left alone - the copy arrives as `benchflow-imported-<timestamp>.db`.

**MCP tools return no records.** The served notebook must exist - start the app once. Check
`BENCHFLOW_DB_PATH` is not pointing at a stale copy. Archived projects need `include_archived: true`,
content in phases removed from a record is not searched as active evidence.

**`ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'`** (development only). The
repository - including `venv` - is being synced by cloud storage, and the compiled wheels in it were
built for another machine's Python. Build a per-machine environment:

```powershell
uv venv --python 3.12 "$env:USERPROFILE\.venvs\lab-planner-eln"
& "$env:USERPROFILE\.venvs\lab-planner-eln\Scripts\python.exe" -m pip install -r backend\requirements.txt
```

**Port 5173 is already in use** (`start-dev.ps1` only). Stop the frontend in the terminal running
it, or find the listener with
`Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique`
and stop that process after checking it is the one you mean.

## Repository layout

```text
benchflow_desktop/
├── packaging/              # build.ps1, benchflow.spec (PyInstaller), setup.iss, test_frozen.py
├── seed/                   # the notebook bundled with a fresh install (db + state + uploads)
├── frontend/
│   ├── src/
│   │   ├── components/     # FlowCanvas, Layout, Modal (editor + attachments), Views
│   │   ├── store/          # state, autosave, API synchronization
│   │   ├── types/          # experiment, phase, attachment types
│   │   └── utils/          # scheduling, Gantt, CSV, graph helpers
│   └── scripts/            # regression and browser checks
├── backend/
│   ├── app/
│   │   ├── main.py         # FastAPI app; also serves the built UI
│   │   ├── paths.py        # where this install keeps data, uploads, logs
│   │   ├── seed.py         # first-run notebook import from a folder or the bundled seed
│   │   ├── backup.py       # OneDrive sync: publish/pull, snapshot, incremental mirror
│   │   ├── notebook_queries.py   # read-only queries behind the API and MCP
│   │   ├── mobile_sync/    # phone sync: merge rules, ops/pairing, the sync app (ADR 0002)
│   │   └── ...             # db_service, schemas, imaging, folder picker, dialogs
│   ├── desktop.py          # the desktop entry point: window, import, backup/restore, --mcp
│   ├── mcp_server.py       # read-only MCP server (dev checkout form)
│   ├── run.py              # API-only development entry point
│   └── tests/              # pytest suite
├── mobile/                 # Android companion (Capacitor); spike results in SPIKE.md
├── docs/                   # setup.md, parity/security checklists, adr/
├── start-dev.ps1 / .sh     # Vite + API development launchers
└── UPSTREAM.md             # which web-app commit this was copied from, and what differs
```

## Relationship to the web app

This repository is a port of the Benchflow web app, vendored from the commit recorded in
`UPSTREAM.md`. The web app stays the reference implementation: a fix there is expected to arrive
here, and a fix here is expected to go back. `backend\tests\test_parity_with_web.py` compares the
two trees and fails if this repo loses a file it should not have lost (deliberate removals are
listed in its `DROPPED` set, with the reason). Content differs where being a desktop app forces it:
`app/paths.py`, `app/database.py`, the first-run import in `app/main.py`, the Settings page, and
`desktop.py`.

There is **no sync** between the two installs and no shared file. Import once, then pick one app to
write in; the OneDrive backup is what carries a notebook between machines.

## Documentation

| File | What it covers |
| --- | --- |
| `docs/setup.md` | Install, first run, CLI modes, nightly backup, building the installer, developing here |
| `docs/adr/0001-api-runs-inside-the-window-process.md` | Why one process holds the API and the window |
| `docs/adr/0002-mobile-sync.md` | Phone sync: revs, tombstones, merge rules, the Tailscale sync app, the multi-PC gate |
| `docs/parity-checklist.md` | What was checked against the web app, and what is still unverified |
| `docs/security-checklist.md` | Threat model for a local app with no authentication |
| `UPSTREAM.md` | The web-app commit this was vendored from and the diff between the trees |
| `MCP_setup.md` | A working MCP client setup, step by step |
| `mcp_integration_planning.md` | MCP design, protocol research, roadmap |

## Changelog

Dates are the day the work was checked against a build, not the day it was written.
The web app is the reference implementation — see `UPSTREAM.md` for which commit was vendored.

### Unreleased — Android companion

Phone sync over Tailscale (`docs/adr/0002-mobile-sync.md`), and the phone app itself (`mobile/`).

#### Notebook

- Opening a notebook upgrades it once: every record gets a revision number, every attachment block
  gets a stable id, and new tables record deletions, sync conflicts and applied phone edits. The
  upgraded notebook is marked as schema version 1. **Update every PC that shares a notebook through
  OneDrive:** an older build refuses to open a newer notebook and says so in the log, rather than
  saving over the new fields.
- An open window no longer overwrites experiments it did not edit. It sends only the experiments
  you changed, each with the version you started from, and the server merges them field by field.
  Changes made elsewhere show up in the open window within a few seconds.

#### Calendar

- Phase dates stored in the long form some imported notebooks use ("Tuesday, June 23, 2026") now
  show on the calendar, in its unscheduled tray, in the sidebar's scheduled count and in the
  editor's date fields. They were skipped before, as the Gantt chart already handled them. The
  stored text is not rewritten until you change the date.

#### Experiment editor

- Each phase has a **Deviations** log: what differed from the plan, with a timestamp. Entries are
  added, not edited. The filter menu has a Deviations filter.

#### Phone sync (desktop end)

- A second local server for the phone starts with the window on `127.0.0.1:18766`, for
  `tailscale serve`. Every request needs a per-device token from pairing.
- Settings > Phone sync publishes it with `tailscale serve`, shows a pairing QR code, lists paired
  phones (with Revoke), and lists sync conflicts. A conflict also shows in the section it belongs to,
  with the set-aside text and a choice of which version to keep.

#### Phone app (Android, `mobile/`)

- Pair by scanning the QR code (or typing the address and code). The whole notebook is kept on the
  phone, so it works offline; edits queue and sync within seconds when the computer is reachable.
- Agenda of today's, upcoming and past phases; search; open a phase or experiment and edit it with
  the desktop's editor, set dates and completion, log deviations, insert the time, keep the screen
  on, and add photos from the camera or gallery (downscaled to 2000 px).
- Attachments for this week's experiments are downloaded so they show offline.
- If the phone and the computer changed the same paragraph, the computer's text is kept and the
  phone's is set aside as a conflict, shown on both.

### 1.0.2 — 2026-11-17 — calendar and flow chart cleanup

No notebook or sync changes; installing over 1.0.1 keeps everything where it is.

#### Calendar

- The page title is the date range, and every calendar control sits in the top bar beside it on
  one row: Month/Week, previous/Today/next, a Phases dropdown, project, search. Phase filters are a
  multi-select dropdown (include or exclude) in the top bar and in the backlog instead of a row of
  toggle buttons.
- The Unscheduled Workflows backlog is a full-height sidebar on the right, like the left nav. Each
  sidebar has one collapse button; the top bar only shows an expand button while that side is
  collapsed.
- Week-view phase cards show the experiment name, its paper and project, then the phase, all left
  aligned. Mark complete and Unschedule appear only while the pointer is over a card, on the name's
  row, sized so the card does not grow.
- Dragging a card's edge resizes it live, including while the pointer is over the card itself.
- Clicking a phase card opens the full-screen editor scrolled to that phase.

#### Experiment editor

- Phases can be reordered by dragging their tabs in the full-screen editor, and the order is kept.

#### Flow chart

- Automatic layout keeps a chain of linked experiments on one row and starts branches on the next
  free row; dependency lines take the simplest route that does not cross a tile, and only detour
  above or below other tiles when there is no other way.
- A new experiment linked from a hand-placed tile lands beside it at the same height when there is
  room. Dragging a tile out of a column moves the tiles below it up into the gap.

#### Removed

- The Gantt link in the sidebar.

#### How to check this release

`node frontend/scripts/<name>.cjs` for every script in `frontend/scripts` (the browser ones need
Playwright and Chrome), including the new `flow-layout-check.cjs` and `calendar-resize-check.cjs`.

### 1.0.1 — OneDrive sync and in-app updates

#### The OneDrive folder is a sync folder, not an archive

A backup used to be one-way: the folder got a copy of this computer's notebook, and whatever the
folder already held was never read. Two computers pointed at one folder therefore overwrote each
other. At startup the app now pulls the folder's notebook in before anything else opens it, and
when the window closes it publishes what this machine has - so each one has the other's work next
time. A push is refused while the folder holds a notebook this machine has not matched, and a real
conflict keeps both copies (data\benchflow-conflict-<stamp>.db, attachments alongside) instead of
choosing one. A machine syncing for the first time adopts the folder's notebook only if its own is
empty; an existing notebook without a shared baseline is a conflict. Later pulls preserve the prior
notebook in data\benchflow-replaced-<stamp>.db. `--backup` from a scheduled task publishes only - it never
pulls, because a pull would replace a notebook the open window still has open - and it now exits
non-zero when the guard refuses instead of reporting success. An open window keeps publishing on
close and every 8 hours; it does not pull while it is up, which is what pulling at startup is for.
`test_sync.py` is the decision table; the two-laptop row in `docs/parity-checklist.md` is not
automatable.

Safety review: publishes now stage the database before replacing the shared file, preserve unique
history snapshots, and refuse unreadable remote notebooks. Pulls stage and validate attachments
before replacing local data, preserve committed SQLite WAL records, and discard remote machine
settings. Attachment name collisions fail without overwriting either file. A local lock prevents
overlapping scheduler, CLI and UI sync operations; it is not a cross-computer OneDrive lock.

#### Updating from inside the app

An installed build asks GitHub for the newest release once per window and, when there is one, offers
to download the setup program and run it; Settings -> Updates does the same on demand. Downloading
changes nothing (about 65 MB into the app's own `updates\` folder), and installing replaces the
program only - the notebook, uploads, settings and the backup folder setting stay where they are,
which is what the uninstaller already guaranteed in reverse. Let Setup close the window rather than
killing the process, because closing is what publishes this notebook. A source checkout or the web app
never sees the card, because neither has an installer to run. `Benchflow.exe --version` prints the
build you are on; `test_update.py` covers the version compare, the folder guard and the download, and
the download itself is a manual row (it is the GitHub CDN, not ours). README's "Updating the app" has
the workflow; the release must be tagged `v<version>` with the setup exe attached, or installed builds
cannot see it.

Update downloads now have a timeout, reject concurrent requests, validate the repository URL and
positive asset size, and verify GitHub's SHA-256 digest when supplied (including cached installers).
Setup revalidates the file against the current release before launching. The UI retains launch
errors and shows successful launch state; prerelease tags are not treated as stable updates.


### 1.0.0 — 2026-11-03 — first desktop build

Vendored from the Lab Planner & ELN web app at `612dbc5` (`UPSTREAM.md`). This is a Windows app:
one `Benchflow.exe`, installed per user without admin rights, notebook and uploads in
`%LOCALAPPDATA%\Benchflow`. Nothing about it needs Node, Python, Docker or a browser tab.

#### What is in it

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

#### How to check this release

```powershell
venv\Scripts\python.exe -m pytest backend\tests -q                 # 48 checks, no network
venv\Scripts\python.exe backend\tests\test_parity_with_web.py     # this repo vs the web repo
venv\Scripts\python.exe packaging\test_frozen.py                  # drives dist\Benchflow\Benchflow.exe
```

#### Deliberate differences from the web app

`app/paths.py` (state in `%LOCALAPPDATA%`, `BENCHFLOW_DATA_DIR` etc.), `app/database.py` (SQLite
only — no PostgreSQL), `app/main.py` (first-run import, static mount, and the CSRF guard: writes
from a foreign `Origin` are refused, and the web app's `allow_origins=["*"]` is not carried over),
native folder dialogs in `app/dialogs.py`, `desktop.py` living under `backend/`, and `README.md`
(opened with a section on what this repository builds — the rest is the web app's own feature
documentation). The parity test
(`backend/tests/test_parity_with_web.py`) prints every file whose content differs; anything in that
list you did not choose is a bug.

#### Fixed during the release work

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

#### Not verified as of this release (every one is a release blocker per the plan)

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

#### Still open

Which repo is the source of truth from here on. The plan's rule is that a fix in one tree is
expected in the other; `test_parity_with_web.py` and `UPSTREAM.md` make the drift visible, but nobody
has decided the direction yet.

## License

MIT License.

