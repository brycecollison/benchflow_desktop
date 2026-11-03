"""Log files for this build, written outside the install folder and outside the data folder.

Two reasons these exist. Program Files is read-only to a normal user, so the frozen app
cannot write next to its own exe - the uvicorn/stdout log has to go to %LOCALAPPDATA%.
And the MCP server's stdout is its JSON-RPC channel, so it cannot log there; its stderr is
swallowed by whatever host spawned it (Visual Studio, Claude Code). It writes the app's log
file instead, which is also the file the Help & troubleshooting page collects.

One file, `backend.log`, written by whichever process is running. Capped and rotated, so an
MCP host that restarts the server in a loop cannot fill the disk.
"""
import threading
from datetime import datetime
from pathlib import Path

from app.paths import LOG_DIR

MAX_BYTES = 5 * 1024 * 1024   # ~5 MB per file
KEEP = 2                      # generations kept: backend.log, backend.log.1, backend.log.2

_lock = threading.Lock()      # uvicorn logs from several threads into one open file


def backend_log_path() -> Path:
    """The app's own log: LOG_DIR, the folder beside the data folder - the same place in dev
    and frozen, so the developer and the support request look in one place."""
    return LOG_DIR / "backend.log"


def _rotate(path: Path) -> None:
    """backend.log -> backend.log.1 -> backend.log.2, dropping the oldest. Caller must have
    the file closed on Windows (a rename of an open file fails there).

    shortcut: the lock is per-process, so the app and an `--mcp` process rotating in the same
    instant can drop one generation. Fine for a log; revisit if a log ever becomes evidence.
    """
    if not path.is_file() or path.stat().st_size < MAX_BYTES:
        return
    oldest = path.with_name(f"{path.name}.{KEEP}")
    if oldest.exists():
        oldest.unlink()
    for i in range(KEEP - 1, 0, -1):
        older = path.with_name(f"{path.name}.{i}")
        if older.exists():
            older.replace(path.with_name(f"{path.name}.{i + 1}"))
    path.replace(path.with_name(f"{path.name}.1"))


def append(path: Path, message: str) -> None:
    """One line, with a timestamp. Opens, writes, closes - the writer is often a short-lived
    process and the file is read by a human while it is being written."""
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        _rotate(path)
        line = f"{datetime.now().isoformat(timespec='seconds')} {message}".rstrip() + "\n"
        with open(path, "a", encoding="utf-8", errors="replace") as fh:
            fh.write(line)


class _Tee:
    """Console stream + file. Writes go out under a lock and are flushed before returning,
    so a log line is on disk before the process can die - a crashed frozen app is diagnosed
    from this file and nothing else."""

    def __init__(self, console, path: Path) -> None:
        self.console = console
        self.path = path
        self.file = open(path, "a", encoding="utf-8", errors="replace", buffering=1)

    def write(self, text: str) -> int:
        with _lock:
            try:
                if self.console:
                    self.console.write(text)
            except Exception:
                pass  # pythonw has no console; the file still gets everything
            if self.file.tell() > MAX_BYTES:
                self.file.close()
                _rotate(self.path)
                self.file = open(self.path, "a", encoding="utf-8", errors="replace", buffering=1)
            self.file.write(text)
            self.file.flush()
        return len(text)

    def flush(self) -> None:
        with _lock:
            try:
                self.file.flush()
            except Exception:
                pass

    def isatty(self) -> bool:
        return False  # uvicorn reads this and stops emitting ANSI colours into the file

    # uvicorn calls .reconfigure / reads .encoding
    @property
    def encoding(self) -> str:
        return "utf-8"


def tee_stdio() -> None:
    """Send this process's stdout/stderr to backend.log as well as the console. Called by
    desktop.py when frozen (a pythonw process has no console to look at)."""
    import sys

    path = backend_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _rotate(path)
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name)
        if isinstance(stream, _Tee):
            continue
        try:
            console = stream if stream and stream.isatty() else None
        except Exception:
            console = None
        setattr(sys, name, _Tee(console, path))
