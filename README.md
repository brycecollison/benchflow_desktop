# Benchflow

Benchflow is a lab planner and Electronic Lab Notebook (ELN) for life science research. Organize projects, publications, experiment dependencies, scheduled workflow phases, and experimental records in one application.

Built with **React 19, TypeScript, Vite 8, Tailwind CSS, Zustand, Tiptap, and FastAPI**, with SQLite persistence and local media storage.

## This repository: the Windows desktop app

This is the desktop port of the Benchflow web app. It ships as one program — no Node, no Python,
no Docker, no browser tab:

- **Install:** `Benchflow-1.0.0-Setup.exe` (per-user, no admin rights). Program in
  `%LOCALAPPDATA\Programs\Benchflow`; notebook, uploads, WebView2 profile and logs in
  `%LOCALAPPDATA\Benchflow`. Uninstalling leaves the notebook alone.
- **Run:** double-click `Benchflow`. One window at a time — a second launch raises the open one.
  `Benchflow.exe --help` lists the other modes: `--mcp` (read-only notebook tools over stdio),
  `--backup`, `--restore`, `--import DIR`, `--version`, `--debug`.
- **Build it:** `packaging\build.ps1`, then check the result with
  `venv\Scripts\python.exe packaging\test_frozen.py`. Details in `docs/setup.md`.
- **How it works and what is still unverified:** `docs/adr/0001-...`, `docs/parity-checklist.md`,
  `docs/security-checklist.md`, `CHANGELOG.md`.

Everything below this line is the feature documentation the web app has — the same application, the
same API. Where it says `npm run dev` / Vite, that is the web repo's development flow; here the API
serves the built bundle itself, so `venv\Scripts\python.exe backend\run.py` is enough to develop.
For MCP from an installed build, use the exe config in `MCP_setup.md`.

## Features

### Planning and navigation

- **Calendar:** the default view on app load, with scheduled experiment phases and responsive week-view cards.
- **Gantt:** an all-projects timeline followed by a chart for each active project. Charts open at today, retain earlier phases to the left, show experiment names beside or inside phase bars, and offer Days/Weeks scales and Today buttons. Completed and unscheduled phases are hidden; clicking a bar opens its experiment.
- **Project flowcharts:** draggable experiment nodes, automatic dependency layout, cycle prevention, connection editing, and optional grid snapping.
- **Project and paper overviews:** organize experiments by project or publication, assign multiple papers to projects, and archive or restore projects and papers.
- **Search and filters:** filter by status, priority, and paper, including include/exclude modes. Gantt also offers project selection and experiment search.
- **Light and dark themes**, with expandable navigation and context sidebars.

### Continuous full-screen experiment editor

Open an experiment, then click **Full Screen** in its popup.

- Included sections appear together in one continuous scrollable document: Purpose, Expected Results, Experimental Design, Experimental Protocol, Data Acquisition, Data Analysis, Results, and Notes. Workflow phases removed from the experiment remain excluded until added back.
- Each section starts with a header and ends with a horizontal rule. Attachment previews appear after the text; the upload controls sit below those previews and above the ending rule.
- Rich-text controls include headings, bold, italic, underline, strikethrough, lists, quotes, code, links, tables, and undo/redo.
- **Tab** indents inside the text editor; **Shift+Tab** outdents. List items support nesting. These keys retain normal focus-navigation behavior outside the editable text.
- Changes autosave. Rich text is stored as Markdown, so the popup and exports retain readable content.
- **Esc** closes the image inspector first, exits full-screen mode next, or closes the regular popup. Dismissing an in-page prompt does not also exit the editor.

### Attachments and screenshot pasting

- Click **Insert image** in a section's formatting toolbar, drag an image into its text, or paste a screenshot directly with **Ctrl+V** (**⌘V** on Mac).
- Pasted screenshots upload automatically and appear inline. The image is also recorded in that section's attachment area and remains available after reloading.
- Each section supports multiple-file uploads, image thumbnails and inspection, CSV/TSV previews, video/audio controls, text notes, and downloadable document cards. Files without an inline preview remain downloadable.
- TIFF and Nikon ND2 support includes scientific metadata and generated web previews where conversion succeeds.
- Attachments belong to the experiment and section, with workflow-phase ownership for Protocol, Acquisition, and Analysis sections. Legacy attachments without ownership appear under Results.
- Removing an attachment card does not delete the original file from disk. Removing an inline image from the text does not automatically remove its attachment card.

**Uploads require the backend.** A failed upload reports an error rather than silently substituting an unsaved local image.

### Read-only agent access

- **MCP integration:** an stdio server exposes the notebook to Claude Desktop, Codex CLI, LM Studio and other MCP clients through three read-only tools and four resources. Search, section text, tables and attachment metadata are readable; nothing in the notebook can be changed by an agent, and the database is opened read-only. See [MCP integration](#mcp-integration-read-only-notebook-access).

## Quick start

### Prerequisites

- **Node.js 22.12+**, or the supported Node 20 line at **20.19+**, and npm.
- **Python 3.12+** for the scientific imaging dependencies in `backend/requirements.txt`.
- **Bash 4.3+** for the Bash launcher; Git Bash on Windows is supported. A PowerShell launcher is also included.

Run the following setup commands from the repository root.

### 1. Install dependencies

**Windows / PowerShell:**

```powershell
py -3 -m venv venv
.\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

**Linux / macOS / Bash:**

```bash
python3 -m venv venv
./venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

Use a Python installation that meets the prerequisite above. Activating the virtual environment is not necessary for the launchers.

### 2. Start both services

**Git Bash / Bash:**

```bash
bash start-dev.sh
```

The Bash launcher resolves paths relative to itself, uses the root `venv`, and stops both services on **Ctrl+C** or when either server exits. Frontend changes reload automatically; restart the launcher after backend changes.

**Windows / PowerShell:**

```powershell
.\start-dev.ps1
```

The PowerShell launcher runs the backend with auto-reload and the frontend in the current terminal. Press **Ctrl+C** to stop the frontend and trigger backend cleanup.

| Service | Address |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend health | http://127.0.0.1:8000/api/health |
| Interactive API documentation | http://127.0.0.1:8000/docs |

These are local development launchers, not a production deployment. The API has no authentication; do not expose it publicly without appropriate access controls.

### Running services separately

In one PowerShell terminal:

```powershell
cd backend
..\venv\Scripts\python.exe run.py
```

In another terminal:

```bash
npm --prefix frontend run dev
```

For a Unix virtual environment, run `../venv/bin/python run.py` from `backend` instead. Vite proxies `/api` and `/uploads` to `http://127.0.0.1:8000`; the frontend alone cannot upload files or sync records to the server.

## Troubleshooting

### Screenshot or file upload returns 502, 503, or 504

A gateway error can mean the frontend cannot reach the backend. Check http://127.0.0.1:8000/api/health and inspect the backend terminal for startup errors. Confirm dependencies were installed into the root `venv`.

Stop any existing frontend process before launching both services again:

```bash
bash start-dev.sh
```

If the page stays open while the backend is down, it shows an error banner instead of records; the browser no longer serves cached data.

### The page loads but no projects or experiments appear

The frontend now reports the failed request in a banner: an empty lab means the backend did not answer, not that the data is gone.

The usual cause on a second machine is that the repository - including the root `venv` - is synced by cloud storage, and the compiled wheels in `venv` were built for the other machine's Python version. The backend then dies at import with `ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'` (or a `PydanticImportError`). `start-dev` tests each candidate interpreter with `import fastapi, sqlmodel` and starts the first that works: the root `venv`, then `~/.venvs/lab-planner-eln`. Build that per-machine environment once:

```powershell
uv venv --python 3.12 "$env:USERPROFILE\.venvs\lab-planner-eln"
& "$env:USERPROFILE\.venvs\lab-planner-eln\Scripts\python.exe" -m pip install -r backend\requirements.txt
```

On Bash: `uv venv --python 3.12 "$HOME/.venvs/lab-planner-eln"` and the same `pip install`. Any other environment works too if you export `BENCHFLOW_PYTHON` pointing at its `python`/`python.exe`.

### Port 5173 is already in use

Press **Ctrl+C** in the terminal running the old frontend. If that terminal is unavailable, stop the listener from PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force }
```

This forcibly stops the process using that port; verify it is the frontend you intend to stop. Then restart the launcher. Do not kill all Node processes indiscriminately.

### MCP client shows no tools, or the server fails to start

Use absolute paths to the repository's Python and to `backend/mcp_server.py`; JSON on Windows needs escaped backslashes. Confirm the pinned MCP SDK is installed, then start the server by hand from `backend/` (`..\venv\Scripts\python.exe mcp_server.py`) and fix whatever that reports. If installing MCP broke the environment, reinstall from `backend/requirements.txt`: a `pip install mcp` in an environment built by another Python version can leave binary extensions such as `pydantic_core` unusable.

### MCP tools return no records

The notebook file must exist; start the app once so `backend/data/benchflow.db` is created. Check `BENCHFLOW_DB_PATH` points at a current database - a stale copy serves old data. Archived projects need `include_archived: true`, content in phases removed from a record is not searched, and browser edits that never reached the server are invisible to MCP.

## Data and backups

- **`backend/data/benchflow.db`** is the primary SQLite database. The journal runs in TRUNCATE mode, not WAL, so a cloud-synced `-wal` can never end up paired with a different moment of the main file; a 0-byte `benchflow.db-journal` beside it is normal.
- **`backend/data/lab_state.json`** is a secondary JSON snapshot written on state saves and used to initialize an empty database. It is not the primary store once SQLite contains data.
- **`backend/uploads/`** contains uploaded originals and generated previews. Database or JSON backups alone do not include those files.
- Both locations are configurable with `BENCHFLOW_DATA_DIR` and `BENCHFLOW_UPLOAD_DIR` (see `backend/app/paths.py`), so the data can live outside the repository while the code stays in Git.
- The frontend does **not** fall back to browser local storage. If the API is unreachable it shows an error banner, because `POST /api/lab/state` replaces the whole database and an empty or stale local copy would delete projects and experiments.
- The MCP server opens the database read-only and never seeds it. To let an agent read without touching the live notebook, point `BENCHFLOW_DB_PATH` at a copy of the database.

For a consistent file-based backup, stop the backend and copy the data directory and uploads together, or use the built-in backup below. Local SQLite files, the JSON snapshot and uploaded media are excluded from Git.

### Personal OneDrive backup

To choose a backup location:

1. Open **Settings → Personal OneDrive Backup**.
2. Click **Browse** beside **Backup folder path** and select a folder inside your personal OneDrive (e.g. `C:\Users\you\OneDrive\BenchflowBackup`). Cancelling leaves the path unchanged. You can also type a path manually, including a new folder name.
3. Click **Save** to apply the location and take the first backup. Selecting a folder alone does not save the setting.
4. Use **Back up now** whenever you want another snapshot.

The native picker opens on the computer running the backend and requires Python's Tk support and a desktop session. If browsing is unavailable, enter the path manually. A folder outside OneDrive triggers a warning because the local backup will not sync to the cloud.

The **SharePoint Backup** tile is hidden for now. Existing SharePoint settings and automatic exports are unchanged.

Backups also run when the session ends: both `start-dev` launchers take a snapshot at exit (`start-dev.ps1` force-kills the backend, so FastAPI's own shutdown hook cannot run there).

```bash
python -m app.backup                       # the folder configured in Settings
python -m app.backup --dest "C:\Users\you\OneDrive\BenchflowBackup"
```

The first form is what the launchers and a scheduled task should use: it follows the folder you configured and records the same "last backup" the Settings card shows. Scheduled daily (safe while the app is open, it is an online backup, not a file copy) - in Task Scheduler set *Start in* to the `backend` folder, program `<repo>\venv\Scripts\python.exe`, argument `-m app.backup`.

- **`benchflow.db`** plus **`history/benchflow-YYYYMMDD-HHMMSS.db`** (the newest 14) come from SQLite's online-backup API, so the sync client only ever sees a finished, self-consistent file. Keeping the *live* database in a synced folder is what produces online-only placeholders that the app cannot open, and `benchflow-DESKTOP-ABC.db` conflict copies that diverge into two notebooks. That is why the live data stays on local disk and the snapshot is what travels.
- **`uploads/`** receives the attachments your notebook content references, under their original names. Files no content points at are listed in `manifest.json` (`unreferenced`, with sizes) and are **not** copied - on a real notebook that is the difference between ~0.1 GB and ~1.1 GB of quota. The mirror never deletes, so `rm` locally cannot empty the cloud copy; prune it by hand when quota matters.
- A destination inside the code folder is rejected, and starting the app with the repository itself inside a OneDrive folder logs a warning: git and a sync client on the same tree carry machine-built `venv` wheels between machines. Keep the repo outside OneDrive and clone it fresh on each machine rather than dragging the folder between synced locations.
- `python -m app.backup` also prints the unreferenced count, and `python tests/test_backup.py` checks the snapshot, the incremental mirror, the append-only rule, history rotation and the folder validation.

## Development checks

From the repository root:

```bash
npm --prefix frontend run build
npm --prefix frontend run lint
node frontend/scripts/gantt-check.ts
node frontend/scripts/section-attachments-check.ts
node frontend/scripts/start-dev-check.cjs
node frontend/scripts/backup-browse-check.cjs
```

The direct TypeScript checks require a Node version with built-in TypeScript stripping, such as **Node 22.18+ or 24**.

Backup snapshots and native folder picker checks (isolated temporary data; the picker checks do not open a dialog):

```powershell
.\venv\Scripts\python.exe backend/tests/test_backup.py
.\venv\Scripts\python.exe backend/tests/test_folder_picker.py
```

Backend attachment validation, database round trips, and uploads:

```powershell
.\venv\Scripts\python.exe backend/test_section_attachments.py
```

Use `./venv/bin/python` on Unix. The attachment checks use an isolated database and temporary uploads.

HTTP route round trips - health, state read and write, upload, experiment position, backup endpoint:

```powershell
.\venv\Scripts\python.exe backend/test_api.py
```

This runs the FastAPI app in-process against a throwaway notebook in a temporary folder (`BENCHFLOW_DATA_DIR` / `BENCHFLOW_UPLOAD_DIR`, see `backend/app/paths.py`). Keep it that way: the test replaces the whole lab state and uploads a file, so pointed at `backend/data/benchflow.db` it stamps `updated_at` on every project and experiment and leaves the uploaded files behind.

MCP tool behaviour, search ranking, section retrieval, database safety, and a real stdio protocol round trip:

```powershell
.\venv\Scripts\python.exe backend/test_mcp.py
```

This check builds a temporary notebook database and never opens `backend/data/benchflow.db`.

Optional browser checks require **Playwright** resolvable by Node and an installed **Google Chrome**. To install the test tool locally without changing the project's dependency manifests or lockfile:

```bash
npm --prefix frontend install --no-save --package-lock=false playwright
node frontend/scripts/experiment-editor-check.cjs
node frontend/scripts/gantt-browser-check.cjs
node frontend/scripts/calendar-cards-check.cjs
```

These browser checks run temporary Vite servers with mocked notebook APIs. They cover editor formatting, clipboard screenshots, attachment ownership and errors, layout, Calendar defaults, and Gantt interactions; they do not replace live backend or microscopy-conversion checks.

## MCP integration (read-only notebook access)

An stdio **MCP server** lets MCP clients and coding agents (Claude Desktop, Codex CLI, LM Studio, Cursor, Continue, OpenClaw) read the notebook: find experiments, read section text, table cells and attachment metadata. It is **read-only**. There are no tools to create, edit, complete, delete, import, upload, schedule or run experiments, and every database connection is opened read-only.

### Files

| Path | Purpose |
| --- | --- |
| `backend/mcp_server.py` | Server: three tools, four resources, read-only annotations |
| `backend/app/notebook_queries.py` | Read-only queries, section extraction, search ranking, response shapes |
| `backend/test_mcp.py` | Query behaviour tests plus a real stdio protocol round trip |
| `mcp_integration_planning.md` | Design, protocol research, risks, roadmap |

`backend/app/main.py` is not imported: it initializes and can seed the database. The server reuses only the phase rules from `app/db_service` and reads `backend/data/benchflow.db` through `sqlite3` in `mode=ro`.

### Install, test, run

`backend/requirements.txt` pins the MCP SDK (`mcp==2.3.0`). From the repository root:

```powershell
.\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\venv\Scripts\python.exe backend/test_mcp.py
```

Manual start; the app does not need to be running, and starting the server never seeds a notebook:

```powershell
cd backend
..\venv\Scripts\python.exe mcp_server.py
```

MCP messages go to stdout, logs to stderr. The process exits when the client closes stdin.

### Tools

| Tool | Read-only behaviour |
| --- | --- |
| `list_projects` | Projects with experiment counts; archived hidden unless `include_archived` |
| `search_experiments` | Ranked keyword search over active sections; filters: project, section, status, archived; pagination |
| `get_experiment` | One record: sections, phase state, dependencies, papers, attachment metadata, record and retrieval time |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

### Resources

| URI | Content |
| --- | --- |
| `benchflow://projects` | Non-archived project list |
| `benchflow://projects/{project_id}` | Experiments in a project and which of their sections have content |
| `benchflow://experiments/{experiment_id}` | Full record with all sections |
| `benchflow://experiments/{experiment_id}/sections/{section_key}` | One section, including its attachment blocks |

Valid section keys: `purpose`, `expectedResults`, `experimentalDesign`, `experimentalProtocol`, `dataAcquisition`, `dataAnalysis`, `results`, `notes`, plus each record's custom phase ids.

### Client configuration

Replace `/path/to/Benchflow` with the absolute path to this repository. JSON on Windows needs escaped backslashes (`C:\path\to\Benchflow`). Restart the client after editing its config.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "benchflow": {
      "command": "/path/to/Benchflow/venv/bin/python",
      "args": ["/path/to/Benchflow/backend/mcp_server.py"],
      "env": { "PYTHONIOENCODING": "utf-8" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`; use `python.exe` and `venv\Scripts` on Windows):

```toml
[mcp_servers.benchflow]
command = "/path/to/Benchflow/venv/bin/python"
args = ["/path/to/Benchflow/backend/mcp_server.py"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
required = false
```

`required = false` keeps Codex usable when this machine has no notebook, for example a work laptop.

**LM Studio** (Settings, **MCP** tab, **Edit mcp.json**, then enable the server and set the tool timeout to about 60 s):

```json
{
  "mcpServers": {
    "benchflow": {
      "command": "/path/to/Benchflow/venv/bin/python",
      "args": ["/path/to/Benchflow/backend/mcp_server.py"],
      "env": { "PYTHONIOENCODING": "utf-8" },
      "isActive": true
    }
  }
}
```

LM Studio has no built-in Benchflow connector, so the custom entry above is required. The first start imports the scientific Python stack, which is slow; raise the startup timeout if the client reports one.

### Database safety and privacy

- The database is opened read-only (`mode=ro` plus `PRAGMA query_only`). The server never creates, migrates, seeds, writes, locks for writing, deletes files, or scans uploads.
- A missing notebook file is a clear tool error. The default path is `backend/data/benchflow.db`; `BENCHFLOW_DB_PATH` overrides it, including in client configuration.
- To keep an agent away from the live notebook, point `BENCHFLOW_DB_PATH` at a copy of the database (copy the `-wal` and `-shm` files too, or copy after stopping the backend) and refresh that copy when you want the agent to see new work.
- Tool output contains no secrets, API keys, environment contents, uploads directory listings, filesystem paths, ports, shell access, network access, `app_url` values that are executable endpoints, image bytes, table files, source code, or configuration.
- Attachment **metadata** is visible (name, type, format, dimensions, ND2/TIFF scientific fields, table cell previews); attachment **contents** are not served, and no `uploads/` path is returned.
- There is no authentication. MCP runs locally, so anyone who can configure a client on that machine can read everything in the served notebook. Archived projects are excluded unless a tool call asks for them.

### What agents may conclude

Server instructions and tool descriptions tell the agent that Expected Results is a prediction, not an observation; a scheduled phase is a plan, not evidence that data were collected; an empty section means "not documented" and must never be invented (retrieval reports `missing_sections`); attachment metadata is not image content; unsynchronized browser edits are invisible, so check `updated_at`; cite section URIs (`benchflow://experiments/<id>/sections/<key>`) in summaries.

Retrieval also exposes the interpretation the UI already has. Phases removed from a record are reported as `included: false` and their content is not searched as active evidence. Archived projects are excluded by default. An empty section and a missing (not applicable) section are separate facts. Long sections are truncated at 4000 characters with `truncated: true`; search returns at most 50 ranked hits with `next_offset`.

Current limits: search is literal, case-insensitive substring matching over names and section text (all terms must match; no fuzzy, semantic or image search). Images become readable by agents only through the multimodal resources described in the roadmap. `mcp_integration_planning.md` records the design, the protocol research, and the open questions.

## Project layout

```text
benchflow/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FlowCanvas/         # Experiment dependency graphs
│   │   │   ├── Layout/             # Header and navigation
│   │   │   ├── Modal/              # Popup, rich-text editor, attachments, dialogs
│   │   │   └── Views/              # Calendar, Gantt, project/paper overviews
│   │   ├── store/                  # State, autosave, API synchronization
│   │   ├── types/                  # Experiment, phase, and attachment types
│   │   └── utils/                  # Scheduling, Gantt, CSV, graph helpers
│   ├── scripts/                    # Regression and browser checks
│   └── vite.config.ts             # Frontend plugins and backend proxy
├── backend/
│   ├── app/                        # FastAPI, SQLModel, schemas, image processing
│   ├── data/                       # SQLite database and JSON snapshot
│   ├── uploads/                    # Local originals and previews
│   ├── requirements.txt
│   ├── run.py                      # Backend development entry point
│   ├── mcp_server.py               # Read-only MCP server for agents
│   ├── test_mcp.py                 # MCP behaviour and protocol checks
│   └── test_section_attachments.py
├── start-dev.sh                    # Bash launcher
├── start-dev.ps1                   # PowerShell launcher
└── README.md
```

## License

MIT License.
