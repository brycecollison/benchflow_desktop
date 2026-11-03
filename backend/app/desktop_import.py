"""First-run data import for the desktop build.

When the desktop data folder has no benchflow.db yet, seed it by COPYING (never
moving) the notebook from a source folder. Source, in order:

  1. ``--import <dir>``          (CLI, for scripting)
  2. a folder the user picks     (the first-run dialog, prefilled with the best guess)
  3. the bundled ``seed/``       (a clean machine uses this automatically)

A source is a folder laid out like the web app's ``backend/``: a ``data/`` folder
holding ``benchflow.db`` + ``lab_state.json``, and an ``uploads/`` folder. The bundled
``seed/`` has exactly that layout (``seed/data/`` + ``seed/uploads/``). Copies are
reference-preserving: uploads keep their original file names, so the imported db's
``/uploads/<name>`` links stay valid.

If the source is inside the code tree it is rejected (that is how the app itself
ends up in a sync folder). If no source is available the app falls back to the
built-in default notebook rather than failing to start.
"""
import os
import shutil
import sys
from pathlib import Path

from app.paths import DATA_DIR, UPLOAD_DIR, DB_PATH


def _frozen() -> bool:
    return getattr(sys, "frozen", False)


def _under(child: Path, parent: Path) -> bool:
    """Case-insensitive containment without resolving reparse points (OneDrive)."""
    c = os.path.normcase(os.path.abspath(str(child)))
    p = os.path.normcase(os.path.abspath(str(parent)))
    return c == p or c.startswith(p.rstrip("\\/") + os.sep)


def _same_path(a: Path, b: Path) -> bool:
    return os.path.normcase(os.path.abspath(str(a))) == os.path.normcase(os.path.abspath(str(b)))


def code_tree() -> Path:
    """The code/bundle tree a source must NOT sit inside."""
    # backend/.. == the repo in dev, the PyInstaller bundle when frozen.
    return Path(__file__).resolve().parent.parent.parent


def _valid_source(src: Path, tree: Path, seed: Path) -> bool:
    """A source is a folder with benchflow.db at its top, outside the code tree.

    The bundled seed is the app's own data and is always valid, even though it sits
    inside the tree (that is where it ships from). The tree check exists to stop a
    circular import from the app's live data/code folder.
    """
    src = Path(src)
    if not (src / "data" / "benchflow.db").is_file():
        return False
    if _same_path(src, seed):
        return True
    if _under(src, tree):
        return False
    return True


def _seed_dir() -> Path:
    """The bundled seed: shipped inside the bundle when frozen, in-repo in dev."""
    if _frozen():
        return Path(sys._MEIPASS) / "seed"
    return code_tree() / "seed"


def _suggested_source(seed: Path, tree: Path) -> Path:
    """Dialog prefill: the web repo's backend/ if it is still on this machine, else the seed."""
    src_file = seed / "source.txt"
    if src_file.is_file():
        recorded = src_file.read_text(encoding="utf-8").strip()
        if recorded:
            cand = Path(recorded).expanduser()
            if _valid_source(cand, tree, seed):
                return cand
    return seed


class _ProgressWindow:
    """A small topmost Tk window that tracks the copy. Degrades to a no-op if Tk is
    unavailable (headless / not bundled), so the import still runs."""

    def __init__(self, title: str):
        self.root = None
        self.label = None
        try:
            import tkinter as tk
            self.root = tk.Tk()
            self.root.title(title)
            self.root.attributes("-topmost", True)
            self.label = tk.Label(self.root, text="Preparing import...", fg="#1a1a1a")
            self.label.pack(padx=24, pady=16)
            self.root.update()
        except Exception:
            self.root = None
            self.label = None

    def update(self, message: str) -> None:
        if self.label is not None:
            self.label.config(text=message)
            self.root.update()
        else:
            print(f"[import] {message}")

    def close(self) -> None:
        if self.root is not None:
            try:
                self.root.destroy()
            except Exception:
                pass


def import_notebook(source: Path, data_dir: Path, upload_dir: Path, progress=None) -> dict:
    """Copy benchflow.db + lab_state.json + uploads/* from source into the data dirs.

    Copies only - the source is never modified. Uploads keep their original file names.
    """
    source = Path(source)
    src_data = source / "data"
    db_src = src_data / "benchflow.db"
    if not db_src.is_file():
        raise ValueError(f"No data/benchflow.db found in {source}")

    data_dir = Path(data_dir)
    upload_dir = Path(upload_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    upload_dir.mkdir(parents=True, exist_ok=True)

    def _say(msg: str) -> None:
        if progress is not None:
            progress(msg)
        else:
            print(f"[import] {msg}")

    _say("Copying database...")
    shutil.copy2(db_src, data_dir / "benchflow.db")

    state_src = src_data / "lab_state.json"
    if state_src.is_file():
        _say("Copying lab_state.json...")
        shutil.copy2(state_src, data_dir / "lab_state.json")

    uploads_src = source / "uploads"
    files = [f for f in uploads_src.iterdir() if f.is_file()] if uploads_src.is_dir() else []
    copied = 0
    for i, f in enumerate(files, 1):
        _say(f"Copying upload {i}/{len(files)}: {f.name}")
        shutil.copy2(f, upload_dir / f.name)
        copied += 1

    return {"source": str(source), "db": str(data_dir / "benchflow.db"), "uploads_copied": copied}


def _pick_folder(initial: Path, title: str):
    """Native folder dialog on the main thread (first run happens before uvicorn
    workers exist, so Tk's main-thread requirement is satisfied). Returns None on cancel
    or if Tk is unavailable."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None
    start = Path(initial).expanduser()
    while not start.is_dir() and start != start.parent:
        start = start.parent
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        return filedialog.askdirectory(parent=root, title=title, initialdir=str(start), mustexist=True) or None
    finally:
        root.destroy()


def _interactive() -> bool:
    """Whether a GUI folder dialog can be shown.

    False under pytest (tests manage their own data dir) and when a headless run is
    requested (``BENCHFLOW_HEADLESS=1``), so a dialog never blocks a non-interactive
    start. In those cases the bundled seed is used instead.
    """
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return False
    if (os.environ.get("BENCHFLOW_HEADLESS") or "").strip().lower() in ("1", "true", "yes", "on"):
        return False
    return True


def resolve_source(cli_import, tree: Path, seed: Path):
    """Pick the import source. Returns (path, how) or (None, None)."""
    if cli_import:
        src = Path(cli_import).expanduser()
        if _valid_source(src, tree, seed):
            return src, "cli"
        raise SystemExit(
            f"error: --import folder {src} is not a valid notebook source "
            "(it has no data/benchflow.db, or it is inside the app's code folder)."
        )

    if _interactive():
        suggested = _suggested_source(seed, tree)
        picked = _pick_folder(suggested, "First run - choose the folder to import your notebook from")
        if picked and _valid_source(Path(picked), tree, seed):
            return Path(picked), "dialog"

    # Dialog cancelled / unavailable / headless -> use the bundled seed.
    if _valid_source(seed, tree, seed):
        return seed, "seed"
    return None, None


def ensure_data_seeded(cli_import=None, verbose: bool = True) -> None:
    """Seed the desktop data folder on first run. Called before any db access."""
    if DB_PATH.exists():
        return
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BENCHFLOW_NO_IMPORT"):
        # Tests (pytest, or standalone scripts that set BENCHFLOW_NO_IMPORT) point
        # BENCHFLOW_DATA_DIR at their own temp folder and manage its contents
        # themselves; the first-run import must not fire (it would open a GUI dialog
        # and/or seed real user data into the throwaway notebook).
        return

    tree = code_tree()
    seed = _seed_dir()
    source, how = resolve_source(cli_import, tree, seed)

    if source is None:
        if verbose:
            print("[import] no notebook source available; starting with the built-in default notebook.")
        return

    progress = _ProgressWindow(f"Importing your notebook from {source}")
    try:
        summary = import_notebook(source, DATA_DIR, UPLOAD_DIR, progress=progress.update)
        if verbose:
            print(f"[import] seeded from {source} ({how}): {summary['uploads_copied']} uploads copied.")
    except Exception as e:
        if verbose:
            print(f"[WARN] first-run import from {source} failed: {e}. Starting with the built-in default notebook.")
    finally:
        progress.close()
