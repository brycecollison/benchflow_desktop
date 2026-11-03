"""Copy an existing notebook into this build's own data folder - one way, never a move.

The desktop app owns %LOCALAPPDATA%\\Benchflow. The web app's `backend/data` +
`backend/uploads` stay exactly as found: opened read-only, never renamed, deleted or
"cleaned up", and nothing here ever writes back to them. Two notebooks, two installs; an
edit in one is invisible to the other, so an import is always asked for and always says
what it did.

Rules (implementation_plan.md §Phase 1):
- Never overwrite an existing desktop file. If `benchflow.db` is already there, the copy
  goes to `benchflow-imported-<timestamp>.db` instead of merging rows, and the caller is
  told - the desktop notebook is not silently replaced.
- Attachments are stored relative to UPLOAD_DIR, so the copied tree resolves as-is; no
  path rewriting in the database.
- The database is copied with SQLite's online-backup API, not shutil: the source may be a
  live notebook the web app is writing, and a byte copy of that can be torn.
"""
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from app.paths import DATA_DIR, DB_PATH, SEED_DIR, STATE_FILE, UPLOAD_DIR, WEB_APP_SOURCE

DB_NAME = "benchflow.db"
UPLOADS_NAME = "uploads"


def needs_import() -> bool:
    """First run: this build has no notebook of its own yet."""
    return not DB_PATH.exists()


def has_notebook(source: Path) -> bool:
    """Is there a copyable notebook in this folder (or in its data/ subfolder)?"""
    return _find_db(source) is not None


def source_candidates() -> List[Path]:
    """Folders that hold a copyable notebook, best guess first.

    The bundled seed travels with the build; the web app's own backend/ is prefilled into
    the first-run dialog only when it still exists on this machine.
    """
    return [p for p in (SEED_DIR, WEB_APP_SOURCE, DATA_DIR.parent) if _find_db(p)]


def _find_db(source: Path) -> Optional[Path]:
    for cand in (source / DB_NAME, source / "data" / DB_NAME):
        if cand.is_file():
            return cand
    return None


def _find_uploads(source: Path) -> Optional[Path]:
    for cand in (source / UPLOADS_NAME, source / "backend" / UPLOADS_NAME, source / "data" / UPLOADS_NAME):
        if cand.is_dir():
            return cand
    return None


def _find_state(source: Path) -> Optional[Path]:
    for cand in (source / "lab_state.json", source / "data" / "lab_state.json"):
        if cand.is_file():
            return cand
    return None


def resolve_source(raw: str) -> Path:
    """A folder the user picked or typed - must contain a benchflow.db."""
    src = Path((raw or "").strip()).expanduser()
    if not _find_db(src):
        raise ValueError(f"No {DB_NAME} found in {src} (looked in the folder itself and in its data/ subfolder).")
    return src


def _copy_db(src_db: Path, dst_db: Path) -> int:
    dst_db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(str(dst_db))
        try:
            con.backup(out)
        finally:
            out.close()
    finally:
        con.close()
    return dst_db.stat().st_size


def _copy_uploads(src_uploads: Path, dst_uploads: Path) -> Dict[str, int]:
    """Copy the attachment tree, keeping relative paths.

    The app stores attachments flat in UPLOAD_DIR and the database holds that name, so a flat
    copy resolves as-is - but a source folder may hold subfolders (an export, an older build),
    and a name like `sub/dir/x.png` is what the database stores for it, so the shape has to
    survive the copy. Existing files are never overwritten (see _find_uploads / import rules).
    """
    dst_uploads.mkdir(parents=True, exist_ok=True)
    copied = present = 0
    for p in sorted(x for x in src_uploads.rglob("*") if x.is_file()):
        dst = dst_uploads / p.relative_to(src_uploads)
        if dst.exists():
            present += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(dst.name + ".part")
        shutil.copy2(p, tmp)
        tmp.replace(dst)  # a half-copied file is never visible under its real name
        copied += 1
    return {"copied": copied, "present": present}


def _backfill_names(target: Path) -> int:
    """Give a copied record that has no name of its own the name of the project it belongs to.

    The UI already shows the project name when a record has none, but the notebook should answer
    that question itself: an export, a folder name and a search all read the record. Only records
    whose name is empty are touched - a record that already has one is never rewritten, and a
    record whose project is missing is left alone rather than invented.
    """
    try:
        con = sqlite3.connect(str(target))
    except sqlite3.Error:
        return 0
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "experiments" not in tables or "projects" not in tables:
            return 0
        cols = {r[1] for r in con.execute("PRAGMA table_info(experiments)")}
        if "name" not in cols or "project_id" not in cols:
            return 0
        cur = con.execute(
            "UPDATE experiments SET name = (SELECT p.name FROM projects p WHERE p.id = experiments.project_id) "
            "WHERE (name IS NULL OR TRIM(name) = '') "
            "AND (SELECT p.name FROM projects p WHERE p.id = experiments.project_id) IS NOT NULL")
        con.commit()
        return cur.rowcount
    except sqlite3.Error:
        return 0
    finally:
        con.close()


# The settings the folder browser and `Benchflow.exe --backup` share. These are the key names this
# codebase already reads (app/main.py, app/backup.py) - they are not renamed or duplicated here.
CONFIG_SETTING_KEYS = ("backup_dir", "sharepoint_dir", "sharepoint_member")


def ensure_desktop_defaults(session) -> List[str]:
    """Create the sync/backup settings on first run, with empty values. Returns the keys created.

    A missing row and an empty value mean the same thing to every caller: not configured. The row
    is created so Settings has something to show and edit; a value the researcher typed is never
    reset, because only absent keys are written.
    """
    from app.db_service import get_setting, set_setting

    created = [key for key in CONFIG_SETTING_KEYS if get_setting(session, key) is None]
    for key in created:
        set_setting(session, key, "")
    return created


def import_notebook(source: str | Path, force: bool = False, dest_dir: Path | None = None,
                    uploads_dir: Path | None = None, state_file: Path | None = None) -> Dict[str, object]:
    """Copy a notebook's db + lab_state.json + uploads into this build's data folder.

    The three destinations default to this build's own folders (app/paths.py); desktop.py and
    the tests pass them explicitly, which is what makes an import testable without touching
    the researcher's real notebook.

    `live` says whether the copy became the app's notebook. It does not when one already
    existed: then the copy lands in `benchflow-imported-<timestamp>.db` and the researcher's
    notebook is untouched, because a mistyped path must not cost them their data. `force`
    (desktop.py's --import --force) is the explicit answer to that: the notebook being replaced
    is kept as `benchflow-replaced-<timestamp>.db` and its uploads as `uploads-replaced-<timestamp>`
    before the copy takes their place. Either way the source is only ever read.
    """
    dest_dir = Path(dest_dir) if dest_dir else DATA_DIR
    # Same rule as app/paths.py: uploads and the state file sit with the data folder, so a
    # caller that only says where the notebook goes still gets a self-consistent set.
    uploads_dir = Path(uploads_dir) if uploads_dir else dest_dir.parent / UPLOADS_NAME
    state_file = Path(state_file) if state_file else dest_dir / STATE_FILE.name

    src = resolve_source(str(source))
    src_db = _find_db(src)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    live_db = dest_dir / DB_NAME
    target = live_db
    replaced: Optional[str] = None
    live = not live_db.exists()
    if force and live_db.exists():
        live_db.replace(live_db.with_name(f"benchflow-replaced-{stamp}.db"))
        if uploads_dir.is_dir():
            moved = uploads_dir.with_name(f"uploads-replaced-{stamp}")
            uploads_dir.replace(moved)
            replaced = str(moved)
        live = True
    elif not live:
        target = dest_dir / f"benchflow-imported-{stamp}.db"

    db_bytes = _copy_db(src_db, target)
    backfilled = _backfill_names(target)
    state_src = _find_state(src)
    state_copied = False
    if state_src and not state_file.exists():
        state_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(state_src, state_file)
        state_copied = True
    uploads_src = _find_uploads(src)
    uploads = _copy_uploads(uploads_src, uploads_dir) if uploads_src else {"copied": 0, "present": 0}

    return {
        "source": str(src),
        "db": str(target),
        "db_bytes": db_bytes,
        "live": live,
        "experiments": _count_experiments(target),
        "backfilled_names": backfilled,
        "uploads_dir": str(uploads_dir),
        "replaced_db": str(live_db.with_name(f"benchflow-replaced-{stamp}.db")) if replaced else None,
        "replaced_uploads": replaced,
        "state_file": state_copied,
        **uploads,
    }


def _count_experiments(db_path: Path) -> int:
    """How many records the copy holds - the number a researcher checks an import against."""
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            return con.execute("SELECT COUNT(*) FROM experiments").fetchone()[0]
        finally:
            con.close()
    except sqlite3.Error:
        return -1  # table name changed under us; the count is a report, not a precondition
