"""Where this build's data lives, kept separate from where the code lives.

The desktop build has its **own** data folder: %LOCALAPPDATA%\\Benchflow. The web app's
in-repo `backend/data` + `backend/uploads` are a different notebook and are never opened
for writing from here (see app/seed.py, which copies from it once, one way). Keeping the
data out of the code tree also keeps it out of reach of the sync client that watches the
repository (git + OneDrive on one tree causes cross-machine wheel/venv breakage and
merge churn); only the backup snapshot travels.

BENCHFLOW_DATA_DIR moves the notebook and, with it, the uploads and log folders beside it;
BENCHFLOW_UPLOAD_DIR / BENCHFLOW_LOG_DIR override one of them alone; BENCHFLOW_APP_DATA moves
the folder that holds the instance lock and the WebView2 profile. That is how the tests and a
developer get an isolated notebook. No side effects here: callers create directories.
"""
import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


def _app_root() -> Path:
    """The read-only code tree.

    Dev: `backend/`. Frozen: `sys._MEIPASS` (the bundle's `_internal` folder) - the
    install dir and everything beside it must never hold writable data.
    """
    return Path(sys._MEIPASS) if FROZEN else Path(__file__).resolve().parent.parent


BASE_DIR = _app_root()


def _local_app_data() -> Path:
    local = (os.environ.get("LOCALAPPDATA") or "").strip()
    # shortcut: Windows-only fallback, for running the frozen tree elsewhere; the shipped
    # build always has LOCALAPPDATA.
    return Path(local) if local else Path.home() / ".local" / "share"


def _resolve(env_key: str, default: Path) -> Path:
    raw = (os.environ.get(env_key) or "").strip()
    return Path(raw).expanduser() if raw else default


APP_DATA_DIR = _resolve("BENCHFLOW_APP_DATA", _local_app_data() / "Benchflow")


DATA_DIR = _resolve("BENCHFLOW_DATA_DIR", APP_DATA_DIR / "data")
# uploads and logs sit beside the data folder, so pointing BENCHFLOW_DATA_DIR somewhere else
# moves the whole set with it - there is one knob for "where this build writes".
UPLOAD_DIR = _resolve("BENCHFLOW_UPLOAD_DIR", DATA_DIR.parent / "uploads")
LOG_DIR = _resolve("BENCHFLOW_LOG_DIR", DATA_DIR.parent / "logs")
# Where a downloaded installer lands (app/update.py). Deliberately not inside the code tree, and
# not inside the sync folder: an installer is this machine's file, and it must never travel.
UPDATE_DIR = APP_DATA_DIR / "updates"
DB_PATH = DATA_DIR / "benchflow.db"
STATE_FILE = DATA_DIR / "lab_state.json"

# Built UI, served by the app itself at "/" (app/main.py) so there is one origin and no
# Vite at runtime. Frozen: bundled at <_MEIPASS>/frontend/dist; dev: this repo's frontend/dist.
FRONTEND_DIST = (BASE_DIR / "frontend" / "dist") if FROZEN else (BASE_DIR.parent / "frontend" / "dist")

# First-run notebook import reads this folder: the web app's backend/ (data/ + uploads/),
# or the seed/ copy that the build bundles next to the exe (<_MEIPASS>/seed).
SEED_DIR = (BASE_DIR.parent / "seed") if not FROZEN else (BASE_DIR / "seed")
WEB_APP_SOURCE = Path("C:/Users/bryce/Desktop/Repos/Lab Planner and ELN/backend")

# WebView2's own profile (cookies, cache). Kept out of the temp dir so a WebView2 profile is
# never left behind there, and never inside Program Files.
WEBVIEW_DATA_DIR = APP_DATA_DIR / "webview"
