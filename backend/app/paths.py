"""Where the notebook's data lives, kept separate from where the code lives.

The repository must stay out of OneDrive (git + a sync client on the same tree causes
cross-machine wheel/venv breakage and merge churn). The data - benchflow.db,
lab_state.json and every upload - is what belongs in the synced/backup folder.
BENCHFLOW_DATA_DIR / BENCHFLOW_UPLOAD_DIR point the app at it; the defaults are the
historic in-repo locations. No side effects here: callers create directories.
"""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _frozen() -> bool:
    return getattr(sys, "frozen", False)


def _default_data_dir() -> Path:
    # Frozen: the app's own data home (%LOCALAPPDATA%\Benchflow) - kept out of the
    # read-only bundle and out of any sync client. Dev: the historic in-repo folder.
    if _frozen():
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(local) / "Benchflow"
    return BASE_DIR / "data"


def _resolve(env_key: str, default: Path) -> Path:
    raw = (os.environ.get(env_key) or "").strip()
    return Path(raw).expanduser() if raw else default


DATA_DIR = _resolve("BENCHFLOW_DATA_DIR", _default_data_dir())
# Uploads live under the data dir when frozen (they are data, not code); in dev they
# stay in the historic backend/uploads location.
UPLOAD_DIR = _resolve("BENCHFLOW_UPLOAD_DIR", DATA_DIR / "uploads" if _frozen() else BASE_DIR / "uploads")
DB_PATH = DATA_DIR / "benchflow.db"
STATE_FILE = DATA_DIR / "lab_state.json"
