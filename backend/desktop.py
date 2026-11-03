"""Benchflow desktop entry point.

Double-clicking Benchflow.exe starts the FastAPI app on 127.0.0.1 on a free port and shows
it in a WebView2 window. One process, one port, no Vite: the built UI is served by app.main
itself (the mount at the bottom of app/main.py), in dev and in the build alike. This file
has no dev/proxy branch - that was the web app's job.

Single file because these modes are one program: the window, the first-run notebook import,
the backup/restore/import CLI, and the MCP server all need the same path resolution, the
same single-instance guard, and the same "no server when you are not the window" rule.

Data lives in %LOCALAPPDATA%\\Benchflow (see backend/app/paths.py). The install folder -
usually Program Files, read-only to a normal user - holds code only.
"""
import argparse
import ctypes
import ctypes.wintypes
import json
import os
import shutil
import signal
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# Run as `python backend/desktop.py`, or frozen inside the PyInstaller archive (where app.*
# already lives in the archive and this is a no-op).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import logpaths  # noqa: E402  (path setup comes first)
from app import seed as seeding  # noqa: E402
from app.paths import (  # noqa: E402
    APP_DATA_DIR,
    DATA_DIR,
    DB_PATH,
    FROZEN,
    LOG_DIR,
    SEED_DIR,
    UPLOAD_DIR,
    WEBVIEW_DATA_DIR,
)
from app.sharepoint_export import APP_VERSION  # the one version string, also in every manifest

APP_NAME = "Benchflow"
WINDOW_TITLE = "Benchflow"
MIN_WIDTH, MIN_HEIGHT = 900, 600
SHUTDOWN_GRACE_SECONDS = 5.0
LOADING_HTML = """<!doctype html><meta charset=utf-8><title>Benchflow</title>
<body style="font:14px/1.6 system-ui;margin:4rem;color:#444">
<h2 style="font-weight:600">Benchflow</h2><p id=note>Starting up&hellip;</p>
"""


# -- Modes ------------------------------------------------------------------------

MODES = f"""modes:
  (no arguments)      open the window. The web server runs inside this process.
  --import DIR        copy an existing notebook into {APP_DATA_DIR} and exit. DIR is the web
                      app's backend/ folder (data/ + uploads/) or any folder containing them.
                      Refuses to overwrite an existing notebook: pass --force to replace it
                      (the replaced notebook is kept as benchflow-replaced-<timestamp>.db).
  --backup            snapshot the notebook to the backup folder configured in Settings, the
                      same way the Settings button and the closing app do.
  --restore [DIR]     copy a snapshot back into {APP_DATA_DIR} and exit. DIR defaults to the
                      configured backup folder. Restores what a backup took: benchflow.db plus
                      the referenced attachments under uploads/. Refuses to overwrite an
                      existing notebook unless --force. Close the app first.
  --mcp               run the read-only notebook MCP server on stdio and exit: no window, no
                      web server, nothing written to the notebook. Point your MCP client at
                      this executable, not at the Python interpreter that is not installed.
  --debug             open the window with the WebView2 devtools attached.

data:   {APP_DATA_DIR}
logs:   {LOG_DIR}
"""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="Benchflow",
        description=(
            "Benchflow - offline lab planner and electronic lab notebook. "
            "Opens the window; the modes below do something else and exit."
        ),
        epilog=MODES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--import", dest="import_dir", metavar="DIR",
                        help="copy DIR's notebook into the data folder and exit")
    parser.add_argument("--backup", action="store_true", help="back up and exit")
    parser.add_argument("--restore", nargs="?", const="", default=None, metavar="DIR",
                        help="restore the latest backup and exit")
    parser.add_argument("--mcp", action="store_true", help="run the MCP server on stdio and exit")
    parser.add_argument("--force", action="store_true",
                        help="with --import/--restore: replace the existing notebook")
    parser.add_argument("--debug", action="store_true", help="open the window with devtools")
    parser.add_argument("--version", action="version", version=f"Benchflow {APP_VERSION}")
    return parser.parse_args(argv)


def attach_console() -> None:
    """Give the CLI modes somewhere to print.

    The build is a windowed executable (no console flashes on double-click), so a terminal
    that runs `Benchflow.exe --backup` has no stdout for it to write to. Attach to the parent
    terminal and re-open the streams. No-op when not started from a terminal.
    """
    if os.name != "nt" or sys.stdout is not None:
        return
    try:
        if not ctypes.windll.kernel32.AttachConsole(0):  # 0 = ATTACH_PARENT_PROCESS
            return
        sys.stdout = open("CONOUT$", "w", encoding="utf-8", buffering=1)
        sys.stderr = open("CONOUT$", "w", encoding="utf-8")
        sys.stdin = open("CONIN$", "r", encoding="utf-8")
    except Exception:
        pass


def acquire_instance_lock() -> tuple[object | None, bool]:
    """One window per user account. Returns (handle, we_are_the_only_one).

    The lock is the presence of this file, and its contents are the port, the pid and that
    process's creation time. A live instance is one whose recorded process is still running
    AND whose /api/health still answers: that is what lets a test (or a killed process) leave
    a stale file behind without wedging startup forever. The creation time matters because
    Windows reuses pids, and a dead pid is not a reason to refuse to start.

    Returns (None, False) when another instance owns the app - the caller activates that
    window instead of starting a second server.
    """
    lock_path = APP_DATA_DIR / "desktop.lock"
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    running = read_instance()
    if running and _pid_alive(running["pid"], running["created"]) and _healthy(running["port"]):
        return None, False
    # The file is here but nothing owns it: its process is gone (a crash, a killed test), or its
    # contents are unusable - _create_exclusive creates the file empty, so a process killed between
    # acquiring the lock and write_instance() leaves a blank file behind. Either way it must go:
    # otherwise the next start finds a file, tries to activate a window that does not exist, and
    # never opens one (which is what a wedged install looks like: double-click, nothing happens).
    lock_path.unlink(missing_ok=True)

    handle = _create_exclusive(lock_path)
    if handle is None:  # another instance won the race between the check and the create
        return None, False
    return handle, True


def read_instance() -> dict | None:
    """The {port, pid, created} recorded by whichever instance owns the app, or None."""
    try:
        port, pid, created = (APP_DATA_DIR / "desktop.lock").read_text(encoding="utf-8").split()
        return {"port": int(port), "pid": int(pid), "created": int(created)}
    except (OSError, ValueError):
        return None


def _healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def _create_exclusive(path: Path):
    """Create the lock file fail-exclusively, or return None if it already exists."""
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    return fd


def write_instance(port: int) -> None:
    """Record this process as the running instance (port first, so a reader can health-check)."""
    created = _process_create_time(os.getpid())
    (APP_DATA_DIR / "desktop.lock").write_text(f"{port} {os.getpid()} {created}", encoding="utf-8")


def release_instance_lock() -> None:
    (APP_DATA_DIR / "desktop.lock").unlink(missing_ok=True)


# -- "Is that pid still the same process?" ----------------------------------------
# shortcut: Windows-only, as is this build. On another OS everything below reports
# "alive", so the lock file alone decides, and the health check still catches a dead server.

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _filetime_as_int(filetime) -> int:
    return (filetime.dwHighDateTime << 32) | filetime.dwLowDateTime


def _process_create_time(pid: int) -> int:
    """When this pid started, in 100 ns ticks. 0 when unknown."""
    if os.name != "nt":
        return 0
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return 0
    try:
        creation, exit_t, kernel_t, user_t = (ctypes.wintypes.FILETIME() for _ in range(4))
        if not kernel32.GetProcessTimes(handle, ctypes.byref(creation), ctypes.byref(exit_t),
                                       ctypes.byref(kernel_t), ctypes.byref(user_t)):
            return 0
        return _filetime_as_int(creation)
    finally:
        kernel32.CloseHandle(handle)


def _pid_alive(pid: int, created: int) -> bool:
    """True if `pid` is a running process that started at `created`.

    Comparing the start time is what makes this safe against pid reuse: Windows hands a dead
    process's pid to a new one, and a bare OpenProcess would then report the notebook as
    already open.
    """
    if os.name != "nt":
        return True
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        creation = ctypes.wintypes.FILETIME()
        if not kernel32.GetProcessTimes(
            handle, ctypes.byref(creation), ctypes.byref(ctypes.wintypes.FILETIME()),
            ctypes.byref(ctypes.wintypes.FILETIME()), ctypes.byref(ctypes.wintypes.FILETIME()),
        ):
            return True  # alive but unreadable timing: treat it as live, the health check decides
        return not created or _filetime_as_int(creation) == created
    finally:
        kernel32.CloseHandle(handle)


def activate_other_instance() -> int:
    """Bring the already-open window to the front. Exits 0 either way - the user sees the app."""
    running = read_instance()
    if not running:
        return 0
    try:
        _bring_to_front(running["pid"])
    except Exception as e:  # noqa: BLE001 - a foreground failure must not look like a crash
        logpaths.append(logpaths.backend_log_path(), f"[desktop] could not focus the open window: {e}")
    return 0


def _bring_to_front(pid: int) -> None:
    """Restore and focus the visible top-level window belonging to `pid`.

    A process cannot call SetForegroundWindow for another process's window unless it owns the
    foreground, so a key-up event with no key is sent first (the usual trick). If that fails the
    window is still restored, which is better than the app staying minimised in the taskbar.
    """
    if os.name != "nt":
        return
    user32 = ctypes.windll.user32
    SW_RESTORE, KEYEVENTF_KEYUP = 9, 2
    enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    window_pid = ctypes.wintypes.DWORD()

    def _match(hwnd, _lparam):
        window_pid.value = 0
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(window_pid))
        # WebView2 keeps invisible windows with no title around; only the titled visible one is ours.
        if window_pid.value != pid or not user32.IsWindowVisible(hwnd) or user32.GetWindowTextLengthW(hwnd) == 0:
            return True
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.keybd_event(0, 0, KEYEVENTF_KEYUP, 0)
        user32.SetForegroundWindow(hwnd)
        return False

    user32.EnumWindows(enum_windows_proc(_match), 0)
    del window_pid  # the callback must not be collected before EnumWindows returns


# -- Window mode: server thread + WebView2 in one process -------------------------

def free_port() -> int:
    """Ask the OS for a port, then let it go so uvicorn can take it.

    shortcut: there is a moment between close() and uvicorn's bind in which another process
    could take this port. Nothing else on the machine is binding ephemeral ports on
    127.0.0.1, and run_window retries the health check rather than assuming success.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def start_server(port: int):
    """uvicorn in a daemon thread. app.main serves /api, /uploads and the built UI."""
    import uvicorn

    from app.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info", access_log=False))
    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()
    return server, thread


def wait_for_server(port: int, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _healthy(port):
            return True
        time.sleep(0.1)
    return False


def folder_dialog(initial: str) -> str | None:
    """Native folder picker, used by the first-run import and by Settings > browse."""
    import webview

    window = webview.windows[0] if webview.windows else None
    if window is None:
        raise RuntimeError("no window to attach the folder dialog to")
    picked = window.create_file_dialog(webview.FOLDER_DIALOG, directory=initial or "")
    return picked[0] if picked else None


def run_window(args: argparse.Namespace) -> int:
    """The app: one port, one window, one process. Blocks until the window is closed."""
    handle, only_instance = acquire_instance_lock()
    if not only_instance:
        return activate_other_instance()

    os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str(WEBVIEW_DATA_DIR)  # never a profile in %TEMP%
    WEBVIEW_DATA_DIR.mkdir(parents=True, exist_ok=True)

    import webview
    from app import dialogs

    dialogs.set_provider(folder_dialog)

    port = free_port()
    log_path = logpaths.backend_log_path()
    if FROZEN:
        logpaths.tee_stdio()  # a double-clicked app has no console; this file is what it leaves behind

    state = {"server": None, "thread": None}

    def stop_server(*_args) -> None:
        """SIGTERM asks for the same exit a closed window does: the lifespan shutdown, which
        runs the closing backup and export. A killed-by-force process never gets here."""
        if state["server"] is not None:
            state["server"].should_exit = True

    try:
        signal.signal(signal.SIGTERM, stop_server)
    except (OSError, ValueError):  # not the main thread, or the platform has no SIGTERM
        pass

    def boot(window) -> None:
        """Runs once the GUI loop is up, before the notebook is opened: the first-run import
        has to happen before the app creates its default notebook in the data folder."""
        try:
            first_run_import(window)
            state["server"], state["thread"] = start_server(port)
            if not wait_for_server(port):
                window.load_html(LOADING_HTML.replace("Starting up&hellip;",
                                                     "The local server did not start. See "
                                                     f"{log_path}"))
                logpaths.append(log_path, "[desktop] the web server never answered /api/health")
                return
            write_instance(port)
            window.load_url(f"http://127.0.0.1:{port}/")
            window.show()
            logpaths.append(log_path, f"[desktop] serving on 127.0.0.1:{port} (frozen={FROZEN}, data={DATA_DIR})")
        except Exception:  # noqa: BLE001 - a crash here would otherwise be invisible
            import traceback

            logpaths.append(log_path, f"[desktop] startup failed:\n{traceback.format_exc()}")

    window = webview.create_window(
        title=WINDOW_TITLE,
        html=LOADING_HTML,
        width=1280,
        height=850,
        min_size=(MIN_WIDTH, MIN_HEIGHT),
        hidden=True,
    )
    # The WebView2 profile (cookies, cache, and the UI's localStorage: sidebar width, calendar
    # tray, snap-to-grid) lives under our data folder, so it is neither in %TEMP% nor in Program
    # Files. private_mode must stay off: it turns on WebView2's InPrivate mode, which keeps
    # localStorage in memory, and the web app's saved preferences would vanish on every restart.
    webview.start(lambda: boot(window), gui="edgechromium", debug=args.debug,
                  private_mode=False, storage_path=str(WEBVIEW_DATA_DIR))

    return shutdown(state["server"], state["thread"], handle)


def shutdown(server, thread, lock_handle) -> int:
    """Window is gone: stop the server so its lifespan shutdown runs the closing backup and
    export, then let the process exit. A backup still in flight after the grace period is
    dropped (logged) rather than keeping a windowless process alive forever."""
    if server is not None:
        server.should_exit = True
    if thread is not None:
        thread.join(SHUTDOWN_GRACE_SECONDS)
        if thread.is_alive():
            logpaths.append(logpaths.backend_log_path(),
                            f"[desktop] web server still running after {SHUTDOWN_GRACE_SECONDS}s; "
                            "exiting anyway, so the closing backup/export may not have finished")
    if lock_handle is not None:
        os.close(lock_handle)
    release_instance_lock()
    return 0


def first_run_import(window) -> None:
    """Ask once, before anything has been written to the data folder.

    This cannot happen after the server starts: the app seeds a default notebook into an empty
    database, so by the time the question could be asked there would already be a notebook to
    overwrite - and the import would silently land in a side file instead. Asked here, with
    nothing decided yet, the answer is the researcher's.
    """
    if not seeding.needs_import():
        return
    log_path = logpaths.backend_log_path()
    suggested = SEED_DIR if seeding.has_notebook(SEED_DIR) else _WEB_APP_FALLBACK()
    source = None
    try:
        if window.create_confirmation_dialog(
            f"{APP_NAME} - first run",
            "There is no notebook in Benchflow's own data folder yet.\n\n"
            "Copy an existing Benchflow notebook in now?\n"
            "Next dialog: the folder containing the web app's data and uploads folders "
            "(its backend folder).\n\n"
            "Choose No to start with an empty notebook. You can also do this later from a "
            f"terminal:\n    Benchflow.exe --import \"<path to backend>\"",
        ):
            source = folder_dialog(str(suggested))
    except Exception as e:  # noqa: BLE001 - no dialog (remote session, odd WebView2) must not block startup
        logpaths.append(log_path, f"[desktop] first-run dialog failed ({e}); using the bundled copy if there is one")
        source = str(SEED_DIR) if seeding.has_notebook(SEED_DIR) else None

    if not source:
        logpaths.append(log_path, "[desktop] first run: empty notebook (import later: Benchflow.exe --import <backend>)")
        return
    try:
        summary = seeding.import_notebook(source)
        logpaths.append(log_path, f"[desktop] imported {summary['experiments']} experiments "
                                  f"from {summary['source']} into {summary['db']}")
    except Exception as e:  # noqa: BLE001 - an unreadable source must still leave a usable app
        logpaths.append(log_path, f"[desktop] import from {source} failed: {e}")
        window.load_html(LOADING_HTML.replace(
            "Starting up&hellip;", f"Could not import {source}: {e}. Starting with an empty notebook."))


def _WEB_APP_FALLBACK() -> Path:
    from app.paths import WEB_APP_SOURCE

    return WEB_APP_SOURCE if WEB_APP_SOURCE.is_dir() else Path.home()


# -- The modes that print something and exit ---------------------------------------

def app_is_open() -> bool:
    running = read_instance()
    return bool(running) and _pid_alive(running["pid"], running["created"]) and _healthy(running["port"])


def _notebook_in(path: Path) -> bool:
    """Local folder, or a mapped drive - the two a file dialog can return.

    A UNC path to a machine that is not this one is refused rather than tried: the import reads
    the notebook with SQLite's online backup and the attachments file by file, so it crawls the
    whole share and a dead link waits out a TCP timeout. The plan says the sync folder is for
    data and backups only, not for a notebook to be imported from.
    """
    raw = str(path)
    if raw.startswith("\\\\"):
        return raw.lower().startswith(("\\\\127.0.0.1\\", "\\\\localhost\\"))
    return True


def _empty_file(path: Path) -> bool:
    """A file that exists but holds nothing - what `type nul > benchflow.db` or a cloud-sync
    placeholder leaves behind. It is not a notebook, and a 0-byte file is not a valid SQLite
    database either, so "replace it" needs no confirmation."""
    try:
        return path.is_file() and path.stat().st_size == 0
    except OSError:
        return False


def _live_notebook_empty(path: Path) -> bool:
    """A real notebook that holds no records - so `--force` may replace it without asking.

    The count is taken on a read-only connection, which says nothing about the live app; the
    app_is_open() check in the callers is what keeps this from racing a running process.
    """
    if not path.is_file():
        return False  # absent is not "empty": the caller takes the no-notebook-yet path
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error:
        return False
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                            "AND name NOT LIKE 'sqlite_%'")]
        if not tables:
            return False  # bytes that are not a database at all: never offer to "replace the empty notebook"
        return sum(con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables) == 0
    except sqlite3.Error:
        return False
    finally:
        con.close()


def run_import_mode(args: argparse.Namespace) -> int:
    if app_is_open():
        print("Benchflow is open. Close its window first - importing replaces files it has open.")
        return 1
    if DB_PATH.exists() and not DB_PATH.is_file():
        print(f"{DB_PATH} exists but is not a file (a folder?). Move it aside and run --import again.")
        return 1
    if not _notebook_in(Path(args.import_dir)):
        print(f"{args.import_dir} is a network share. Copy the notebook folder to this machine (or a "
              "mapped drive) first - an import reads the database and every attachment over that link.")
        return 1
    if args.force and DB_PATH.exists() and not _empty_file(DB_PATH) and not _live_notebook_empty(DB_PATH):
        print(f"--force will not replace the notebook at {DB_PATH}: it holds records.\n"
              "  Run --import without --force (the copy lands beside it as "
              "benchflow-imported-<timestamp>.db), or move that notebook aside yourself.")
        return 1
    if _empty_file(DB_PATH):
        DB_PATH.unlink()  # an accidental empty file is not a notebook; --force does not need to ask about it
    try:
        summary = seeding.import_notebook(args.import_dir, force=args.force)
    except (ValueError, OSError) as e:
        print(e)
        return 1
    if summary["live"]:
        print(f"imported into the notebook Benchflow opens: {summary['db']}")
    else:
        print(f"an existing notebook was already at {DB_PATH}, so nothing there was touched.\n"
              f"  the copy went to: {summary['db']}\n"
              "  to replace the existing one instead (it is kept as benchflow-replaced-<timestamp>.db):\n"
              f"  Benchflow.exe --import \"{args.import_dir}\" --force")
    print(f"  {summary['experiments']} experiments, {summary['copied']} attachments copied "
          f"({summary['present']} already here), {summary['db_bytes'] / 1024:.0f} KB database, "
          f"from {summary['source']}")
    if summary.get("backfilled_names"):
        print(f"  filled in the project name on {summary['backfilled_names']} record(s) that had none")
    return 0


def run_backup_mode() -> int:
    from app.backup import run_configured

    return 0 if run_configured() is not None else 1


def run_restore_mode(args: argparse.Namespace) -> int:
    """Copy a snapshot back. A backup wrote benchflow.db plus the referenced attachments under
    uploads/, so that is what comes back; a manual backup also left unreferenced files in the
    folder, and those stay where they are."""
    if app_is_open():
        print("Benchflow is open. Close its window first - restoring replaces files it has open.")
        return 1
    source = Path(args.restore).expanduser() if args.restore else _configured_backup_dir()
    if not source:
        print("No backup folder given and none configured in Settings. "
              "Use: Benchflow.exe --restore \"<folder containing benchflow.db>\"")
        return 1
    snapshot = source / "benchflow.db"
    if not snapshot.is_file():
        print(f"{source} is not a Benchflow backup: no benchflow.db in it.")
        return 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # A notebook with records in it is not replaced by a restore at all - a restore puts an older
    # snapshot over the live notebook, so the safe path is to move the current one aside by hand.
    # An empty file, or a notebook with nothing in it, is not worth a copy.
    if DB_PATH.is_file() and not (_empty_file(DB_PATH) or _live_notebook_empty(DB_PATH)):
        print(f"{DB_PATH} holds a notebook with records, so this restore refuses and nothing was "
              "changed. Move that notebook out of the data folder first (or rename it), then run "
              "--restore again.")
        return 1
    if _empty_file(DB_PATH):
        DB_PATH.unlink()
    elif DB_PATH.is_file():
        kept = DB_PATH.with_name(f"benchflow-replaced-{time.strftime('%Y%m%d-%H%M%S')}.db")
        DB_PATH.replace(kept)
        print(f"  kept the notebook you had: {kept.name}")

    shutil.copy2(snapshot, DB_PATH)
    # A backup mirrors the attachments the notebook references, keeping the paths the database
    # stores (they can be in subfolders), so they come back the same way. Files already here at
    # the same size are left alone - a manual backup's folder may hold more than it copied.
    files = 0
    restored_bytes = snapshot.stat().st_size
    uploads_src = source / "uploads"
    for item in sorted(uploads_src.rglob("*")) if uploads_src.is_dir() else []:
        if not item.is_file():
            continue
        target = UPLOAD_DIR / item.relative_to(uploads_src)
        if target.exists() and target.stat().st_size == item.stat().st_size:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        shutil.copy2(item, tmp)
        tmp.replace(target)
        files += 1
        restored_bytes += item.stat().st_size
    manifest = source / "manifest.json"
    if manifest.is_file():
        try:
            print(f"  backup taken {json.loads(manifest.read_text(encoding='utf-8')).get('at', '?')}")
        except (OSError, ValueError):
            pass
    print(f"restored {DB_PATH} + {files} attachments ({restored_bytes / 1e6:.1f} MB total) from {source}")
    return 0


def _configured_backup_dir() -> Path | None:
    """The folder in Settings > Personal OneDrive Backup, read without starting the app."""
    if not DB_PATH.is_file():
        return None
    import sqlite3

    try:
        connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        try:
            row = connection.execute("SELECT value FROM settings WHERE key = 'backup_dir'").fetchone()
        finally:
            connection.close()
    except sqlite3.Error:
        return None
    return Path(row[0]) if row and row[0] else None


def reopen_stdio_pipes() -> None:
    """Give --mcp its stdin/stdout back in the frozen build.

    The build has no console, so PyInstaller sets sys.stdin/sys.stdout to None - but an MCP
    client starts the exe with pipes on file descriptors 0 and 1. The handles are there, only
    the Python streams are missing, and mcp_server's stdio transport needs the streams.
    """
    if sys.stdin is None or sys.stdout is None:
        try:
            sys.stdin = os.fdopen(0, "r", encoding="utf-8", closefd=False)
            sys.stdout = os.fdopen(1, "w", encoding="utf-8", buffering=1, closefd=False)
        except OSError:
            pass  # started with no pipes (a --mcp double-click): there is nothing to speak to


def run_mcp_mode() -> int:
    """The MCP server, and nothing else: no web server, no window, no writes to the notebook.

    Keeping the web server out of this process is the point - a second server would hold a
    second view of the notebook and (worst case) a second copy of the data folder.
    """
    import mcp_server

    reopen_stdio_pipes()
    return mcp_server.serve()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.mcp:
        # stdout must carry only MCP JSON-RPC, so no console attaching here.
        return run_mcp_mode()
    if args.import_dir or args.backup or args.restore is not None:
        attach_console()
    if args.import_dir:
        return run_import_mode(args)
    if args.backup:
        return run_backup_mode()
    if args.restore is not None:
        return run_restore_mode(args)
    return run_window(args)


if __name__ == "__main__":
    sys.exit(main())
