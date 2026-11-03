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
| `--backup` | Snapshot the notebook and its referenced attachments into the backup folder set in Settings, then exit. |
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

A backup is a snapshot the app writes into a folder you choose; the live notebook stays on local
disk. This is also how a notebook reaches a second machine.

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
<backup folder>/benchflow.db                          the latest snapshot
<backup folder>/history/benchflow-YYYYMMDD-HHMMSS.db    the newest 14
<backup folder>/uploads/...                            attachments your content points at
<backup folder>/manifest.json                          last run: counts, sizes, unreferenced names
```

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
| **Save** in Settings, or **Back up now** | immediately |
| Closing the window | every time, if a folder is set |
| Window left open | every 8 hours |
| `Benchflow.exe --backup` | on a schedule, e.g. `schtasks /Create /TN Benchflow-Backup /SC DAILY /ST 18:30 /TR "\"%LOCALAPPDATA%\Programs\Benchflow\Benchflow.exe\" --backup"` |

The Settings card reports the folder state (found / not found, inside OneDrive or not) and the last
run: database size, attachments copied, how many were new, snapshot count and timestamp.

### Getting the notebook onto another machine

Back up on the first machine, let OneDrive finish syncing, then on the second machine close
Benchflow and restore:

```powershell
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe" --restore "C:\Users\you\OneDrive\BenchflowBackup"
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe" --restore    # the folder already set in Settings
```

A brand new install has no notebook yet, so it has no configured folder to read - give it the path.
A restore refuses when the existing notebook holds records, and changes nothing when it does; move
`%LOCALAPPDATA%\Benchflow\data\benchflow.db` aside by hand and run it again. A restore brings back
the database and the uploads the notebook references.

### Keep the live data and the code out of OneDrive

Only the backup folder belongs in the synced tree:

- A **live** SQLite file in a synced folder gets replaced by an online-only placeholder the app
  cannot open, and two machines writing the same path produce `benchflow-DESKTOP-ABC.db` conflict
  copies that become two diverging notebooks. That is why the live data stays local and the snapshot
  is what travels.
- A **repository** inside OneDrive drags `.git` and machine-built `venv` wheels between machines.
  The app logs a warning when it starts in that state, and rejects a backup destination inside the
  code folder. Clone the repo fresh on each machine instead of dragging the folder across.

## Where the app keeps its files

| | Installed app | Development checkout |
| --- | --- | --- |
| Notebook | `%LOCALAPPDATA%\Benchflow\data\benchflow.db` | same |
| State snapshot | `%LOCALAPPDATA%\Benchflow\data\lab_state.json` | same |
| Attachments | `%LOCALAPPDATA%\Benchflow\uploads\` | same |
| Logs | `%LOCALAPPDATA%\Benchflow\logs\backend.log` (+ `.1`, `.2`) | same |
| Instance lock, WebView2 profile | `%LOCALAPPDATA%\Benchflow\` | same |
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
venv\Scripts\python.exe -m pytest backend\tests -q      # paths, seed, backup, scheduler, folder picker, CLI, safety, parity
node frontend\scripts\start-dev-check.cjs              # launcher behaviour
node frontend\scripts\backup-browse-check.cjs          # Settings backup card + picker
node frontend\scripts\phases-check.ts                  # phase rules
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
│   │   ├── backup.py       # OneDrive snapshot + incremental mirror
│   │   ├── notebook_queries.py   # read-only queries behind the API and MCP
│   │   └── ...             # db_service, schemas, imaging, folder picker, dialogs
│   ├── desktop.py          # the desktop entry point: window, import, backup/restore, --mcp
│   ├── mcp_server.py       # read-only MCP server (dev checkout form)
│   ├── run.py              # API-only development entry point
│   └── tests/              # pytest suite
├── docs/                   # setup.md, parity/security checklists, adr/
├── start-dev.ps1 / .sh     # Vite + API development launchers
├── UPSTREAM.md             # which web-app commit this was copied from, and what differs
└── CHANGELOG.md
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
| `docs/parity-checklist.md` | What was checked against the web app, and what is still unverified |
| `docs/security-checklist.md` | Threat model for a local app with no authentication |
| `CHANGELOG.md` | What each release changed, including known limits |
| `UPSTREAM.md` | The web-app commit this was vendored from and the diff between the trees |
| `MCP_setup.md` | A working MCP client setup, step by step |
| `mcp_integration_planning.md` | MCP design, protocol research, roadmap |

## License

MIT License.

