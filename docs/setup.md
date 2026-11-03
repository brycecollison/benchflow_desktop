# Benchflow on a lab laptop

One program: `Benchflow.exe`. Double-click it, a window opens, it works with no browser, no
terminal, no Node, no Python. Everything it writes lives in your own profile folder, and the
notebook never has to leave the machine unless you back it up.

```
%LOCALAPPDATA%\Benchflow\
  data\benchflow.db        the notebook (this is the thing to back up)
  data\lab_state.json      the lab notebook's saved state
  uploads\                 attachments, previews generated next to them as *_preview.png
  logs\backend.log         what the app printed (rotated: backend.log.1, .2)
  webview\                 the WebView2 profile: window cookies + your UI preferences
  desktop.lock             while the window is open
```

## Install

Run `Benchflow-<version>-Setup.exe`, or unzip `Benchflow-<version>-windows-portable.zip`
anywhere you can write (the zip is the same program; both behave identically). The installer
needs no administrator rights and installs per Windows account, so two people on one machine
get two separate notebooks.

Start it from the Start menu or Desktop shortcut, or from a terminal:

```powershell
& "$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe"
```

Requirements: 64-bit Windows 10 or 11. The window is drawn with WebView2, which Windows already
has wherever Edge is installed (every lab laptop). If WebView2 is genuinely missing, the window
will not open: install the Evergreen "Microsoft Edge WebView2 Runtime" once.

**Uninstalling** removes the program only. Your notebook, attachments and logs stay in
`%LOCALAPPDATA%\Benchflow` — delete that folder yourself if you are sure you are done with it,
and a newer version picks the notebook up where it is.

## First run

The app asks once, before it writes anything: *Copy an existing Benchflow notebook in now?*
**Yes** opens a folder picker — it defaults to the notebook bundled with the app, so accepting the
default imports that copy; **No** starts an empty notebook. Either way the source is copied and the
original is never written to. After that **this app owns its own notebook and the web app owns its
own.** Neither one sees the other's edits, and there is no sync between them — Settings shows the
exact file paths, and the OneDrive backup is what carries a notebook between machines.

To bring a notebook in later, deliberately, from a folder that looks like the web app's `backend/`
(a `data\benchflow.db` and an `uploads\`):

```powershell
Benchflow.exe --import "C:\Users\you\Desktop\web-backend-copy"        # refuses if a notebook exists
Benchflow.exe --import "C:\Users\you\Desktop\web-backend-copy" --force # replace it
```

That writes a **new** notebook, it does not merge rows. Copy the folder to a local disk first;
the app refuses to read a notebook straight off a network share.

## Command line modes

Everything below does its job and exits; none of them opens a window.

| Command | What it does |
|---|---|
| `Benchflow.exe` | open the window (the only mode that does) |
| `Benchflow.exe --backup` | snapshot the notebook + referenced attachments into the backup folder set in Settings, keeping 14 snapshots in `history\` |
| `Benchflow.exe --restore` | restore the newest snapshot from that backup folder |
| `Benchflow.exe --restore "D:\old-backup"` | restore from another backup folder (refuses if the current notebook holds records - move it aside first) |
| `Benchflow.exe --import DIR` | copy a web-app-style notebook folder in (`--force` to replace) |
| `Benchflow.exe --mcp` | serve the read-only MCP tools over stdio — for `pi`, LM Studio, or any MCP client |
| `Benchflow.exe --version` | print the version and exit |
| `Benchflow.exe --debug` | open the window with devtools attached |

A second copy refuses to start while the window is open and raises the existing window instead.
`desktop.lock` holds the port and pid; a lock left by a crash, a killed process or a wedged
shutdown is noticed and cleared, so you never have to delete it by hand.

**If a double-click does nothing** — no window, and no new line in `logs\backend.log` — a wedged
`desktop.lock` is the usual cause. The app clears it since 1.0.0; on an older build, delete
`%LOCALAPPDATA%\Benchflow\desktop.lock` and start again.

### Nightly backup (optional)

Closing the window already backs up if a backup folder is set. To also do it on a schedule:

```powershell
schtasks /Create /TN Benchflow-Backup /SC DAILY /ST 18:30 `
  /TR "\"$env:LOCALAPPDATA\Programs\Benchflow\Benchflow.exe\" --backup"
```

It runs while the app is open: the writer lock is not in the way, because a backup only reads a
page-for-page consistent copy of the SQLite file.

### Turning the SharePoint / OneDrive export on (off by default)

Settings has no card for this — the web app dropped that card upstream (`87e9560`, "hide SharePoint
settings"), so you set it once through the API. The port the running app listens on is the first
word of `desktop.lock`:

```powershell
$port = ((Get-Content "$env:LOCALAPPDATA\Benchflow\desktop.lock") -split ' ')[0]
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:$port/api/sharepoint/config" `
  -ContentType 'application/json' `
  -Body '{"dir":"C:\\Users\\you\\OneDrive\\BENCHFLOW"}'
```

Give it a **local folder** that the OneDrive/SharePoint sync client already syncs — a
`https://…sharepoint.com/…` URL is refused on purpose. The export writes
`<that folder>\<your Windows username>\`: `manifest.json`, `projects\` (one JSON per project) and
`attachments\` (only the files the notebook's content actually references). Re-running overwrites in
place, so the sync client sees changed files rather than a new folder each time. It runs on every
window close; to run it by hand (and see what it wrote):

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/sharepoint/export"
```

The folder name under the sync folder follows `BENCHFLOW_MEMBER` if you set it (a lab member name
beats the Windows username), which is how two people can export into the same SharePoint folder.

## Building it yourself

```powershell
py -3.12 -m venv venv
venv\Scripts\python.exe -m pip install -r backend\requirements.txt   # includes pyinstaller
npm --prefix frontend ci
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build.ps1
```

That builds the UI, then `dist\Benchflow\Benchflow.exe`, then runs `packaging\test_frozen.py`
(starts the exe, uploads a real `.tif`, generates a preview, closes the window, checks the backup
landed, and asks the exe's own `--mcp` for its tool list). It stops there if that test fails. Then
it writes `dist\Benchflow-<version>-windows-portable.zip` and, if Inno Setup 6 is installed,
`dist\installer\Benchflow-<version>-Setup.exe`. Inno is found on `PATH`, in
`%LOCALAPPDATA%\Programs\Inno Setup 6` (where an unelevated `winget install` puts it), or at
`$env:ISCC`.

Flags: `-SkipTest`, `-SkipInstaller`, and `-Seed` (refreshes `seed\` from the web app's data
folder — pass `-WebRepo <path>` if the web checkout is not the sibling folder named in
`UPSTREAM.md`).

The version comes from `APP_VERSION` in `backend/app/sharepoint_export.py`; bump it there, tag
the commit (`git tag v1.0.0`), and the installer, the exe's file properties and every backup
manifest agree.

## Development in this repo

```powershell
.\start-dev.ps1          # Vite + uvicorn in a browser, the way the web repo does it
venv\Scripts\python.exe backend\desktop.py     # the real window, from source
venv\Scripts\python.exe -m pytest backend\tests -q
node frontend\scripts\start-dev-check.cjs      # browser checks (see the plan's parity section)
```

Useful environment variables when you want an isolated notebook instead of your real one:
`BENCHFLOW_DATA_DIR` (moves the notebook and, beside it, uploads and logs), and
`BENCHFLOW_UPLOAD_DIR` / `BENCHFLOW_LOG_DIR` / `BENCHFLOW_APP_DATA` to move one of them alone.
