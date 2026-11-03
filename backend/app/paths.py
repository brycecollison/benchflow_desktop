"""Where the notebook's data lives, kept separate from where the code lives.

The repository must stay out of OneDrive (git + a sync client on the same tree causes
cross-machine wheel/venv breakage and merge churn). The data - benchflow.db,
lab_state.json and every upload - is what belongs in the synced/backup folder.
BENCHFLOW_DATA_DIR / BENCHFLOW_UPLOAD_DIR point the app at it; the defaults are the
historic in-repo locations. No side effects here: callers create directories.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _resolve(env_key: str, default: Path) -> Path:
    raw = (os.environ.get(env_key) or "").strip()
    return Path(raw).expanduser() if raw else default


DATA_DIR = _resolve("BENCHFLOW_DATA_DIR", BASE_DIR / "data")
UPLOAD_DIR = _resolve("BENCHFLOW_UPLOAD_DIR", BASE_DIR / "uploads")
DB_PATH = DATA_DIR / "benchflow.db"
STATE_FILE = DATA_DIR / "lab_state.json"
