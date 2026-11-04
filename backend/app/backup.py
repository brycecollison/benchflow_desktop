"""Copy the live notebook (database + the attachments it uses) to a personal OneDrive folder.

Layout under <dest>:
    benchflow.db                            latest database snapshot
    history/benchflow-YYYYMMDD-HHMMSS.db   the newest HISTORY_KEEP snapshots
    uploads/<name>                          attachments referenced by notebook content
    manifest.json                           last run (counts, sizes, unreferenced names)

Why a snapshot and not a live data folder under OneDrive: the sync engine parks an
idle SQLite file as an online-only placeholder (the app then cannot open it) and, with a
second machine writing the same path, produces `benchflow-DESKTOP-ABC.db` conflict copies
- two notebooks that diverge silently. The app keeps exactly one live database on local
disk; the snapshot comes from SQLite's online-backup API, so the sync client only ever
sees a finished, self-consistent file.

Only attachments referenced by notebook content are mirrored - `extract_refs` is already
the app's definition of "in use", and on this notebook it is ~10 % of the bytes in
uploads/. Everything else is reported in the manifest as `unreferenced` (name and size,
never the content) so nothing is hidden. The mirror never deletes: a local `rm` cannot
take the OneDrive copy with it.

The same folder is also how a notebook travels between two computers, so the copy is read back
as well as written (sync_pull / publish, below). "Archive" is still what the folder is: one
notebook per machine at a time, no merge, and a copy that would land on top of someone else's
work is refused instead of guessed at.

Run on demand (no --dest: use the folder configured in Settings, which is what the dev
launcher and a scheduled task should do, so they all update the app's "last backup"):
    python -m app.backup
    python -m app.backup --dest C:\\Users\\you\\OneDrive\\BenchflowBackup
"""

import argparse
import hashlib
import json
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from sqlmodel import Session, create_engine

from app.sharepoint_export import APP_VERSION, extract_refs

HISTORY_KEEP = 14
# What this machine last matched the folder with. Lives beside the live notebook, not inside it:
# a pulled notebook carries the other machine's rows, and this file has to survive that.
SYNC_STATE_NAME = "benchflow-sync.json"


def collect_refs(db_path: Path) -> Dict[str, str]:
    """Referenced attachment name -> size in bytes, for the notebook at db_path."""
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    with Session(engine) as session:
        refs = extract_refs(session, Path(db_path).parent / "lab_state.json")
    engine.dispose()
    return refs


def snapshot_db(db_path: Path, dest_db: Path) -> int:
    """Online-backup the database to dest_db. Returns its byte size."""
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(str(dest_db))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return dest_db.stat().st_size


def rotate(history_dir: Path, keep: int = HISTORY_KEEP) -> int:
    """Keep the newest `keep` snapshots; return how many were deleted."""
    snaps = sorted(history_dir.glob("benchflow-*.db"))
    for old in snaps[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)
    return max(0, len(snaps) - keep)


def mirror_uploads(
    uploads_dir: Path, refs: Iterable[str], dest_uploads: Path
) -> Dict[str, int]:
    """Copy missing attachments; refuse name collisions rather than destroy either copy."""
    dest_uploads.mkdir(parents=True, exist_ok=True)
    copied = present = missing = 0
    for name in sorted(refs):
        src = uploads_dir / name
        if not src.exists():
            missing += 1
            continue
        dst = dest_uploads / name
        if not src.resolve().is_relative_to(uploads_dir.resolve()) or not dst.resolve().is_relative_to(dest_uploads.resolve()):
            raise ValueError(f"Attachment escapes uploads folder: {name}")
        if dst.exists():
            with src.open("rb") as a, dst.open("rb") as b:
                identical = hashlib.file_digest(a, "sha256").digest() == hashlib.file_digest(b, "sha256").digest()
            if identical:
                present += 1
                continue
            raise ValueError(f"Attachment collision: {name}; neither copy was overwritten")
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(dst.name + ".part")
        shutil.copy2(src, tmp)
        tmp.replace(dst)  # a half-copied file is never visible under its real name
        copied += 1
    return {"copied": copied, "present": present, "missing": missing}


def unreferenced(uploads_dir: Path, refs: Iterable[str]) -> List[Dict]:
    """Files in uploads/ that no notebook content points at. Listed, never copied, never deleted."""
    refset = set(refs)
    out = []
    for p in sorted(uploads_dir.iterdir()):
        if not p.is_file() or p.name in refset or p.name == ".gitkeep":
            continue
        out.append({"name": p.name, "size": p.stat().st_size})
    return out


def run_backup(db_path: Path, uploads_dir: Path, dest: Path, keep: int = HISTORY_KEEP,
               publish_db: bool = True) -> Dict:
    """Write a snapshot + attachment mirror under dest. Returns the summary.

    publish_db=False keeps benchflow.db (someone else's notebook) untouched and still writes
    history/ + uploads/ + manifest.json - that is how a refused push keeps its own work
    recoverable. `published` in the summary says which of the two ran.
    """
    db_path, uploads_dir, dest = Path(db_path), Path(uploads_dir), Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    history = dest / "history"
    history.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-" + uuid.uuid4().hex[:8]
    snapshot = history / f"benchflow-{stamp}.db"
    db_bytes = snapshot_db(db_path, snapshot)
    refs = collect_refs(snapshot)
    mirror = mirror_uploads(uploads_dir, refs, dest / "uploads")
    if any(not (dest / "uploads" / name).is_file() for name in refs):
        raise ValueError("Referenced attachments are missing; notebook was not published")
    if publish_db:
        # Never let OneDrive see SQLite modifying the published file in place.
        staged = dest / f"benchflow-{uuid.uuid4().hex}.part"
        try:
            shutil.copy2(snapshot, staged)
            staged.replace(dest / "benchflow.db")
        finally:
            staged.unlink(missing_ok=True)
    removed = rotate(history, keep)
    extras = unreferenced(uploads_dir, refs)

    summary = {
        "app_version": APP_VERSION,
        "dest": str(dest),
        "at": datetime.now(timezone.utc).isoformat(),
        "db_bytes": db_bytes,
        "referenced": len(refs),
        **mirror,
        "history": len(list(history.glob("benchflow-*.db"))),
        "history_pruned": removed,
        "published": publish_db,
        # what the folder now holds, so the next pull/push can tell an untouched folder from a
        # notebook the other machine published. Excludes settings, so it matches fingerprint(db).
        "published_fp": fingerprint(snapshot) if publish_db else None,
        "unreferenced_count": len(extras),
        "unreferenced_bytes": sum(e["size"] for e in extras),
        "unreferenced": extras[:200],
    }
    (dest / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


# -- reading the folder back (a notebook moving between two computers) ----------------
# A merge is off the table: the app keeps one live notebook, autosaves the whole state
# (app/db_service.py: save_lab_state hard-deletes what is not in it), and there are no
# tombstones to merge against. So the rule is one writer at a time, and a collision between two
# writers keeps both copies rather than picking one.


def configured_dest(db_path: Path) -> Optional[Path]:
    """The folder this machine is configured to sync with, read off the database without the ORM.

    desktop.py needs it before the server is up, which is the only moment a pull is safe.
    """
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = con.execute("SELECT value FROM settings WHERE key = 'backup_dir'").fetchone()
    except sqlite3.Error:
        row = None
    finally:
        con.close()
    return Path(row[0]) if row and row[0] else None


def fingerprint(db_path: Path) -> Optional[str]:
    """Content hash of a notebook's records, ignoring the settings table.

    settings is excluded because it holds this machine's folder paths: it must not look like a
    notebook change, and a pulled notebook must not carry another machine's paths. None means
    "not a readable database" - absent, 0 bytes (OneDrive's online-only placeholder), or a
    half-copied file, none of which may be treated as an empty notebook.
    """
    p = Path(db_path)
    if not p.is_file() or p.stat().st_size == 0:
        return None
    try:
        con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        h = hashlib.sha256()
        rows = con.execute("SELECT name FROM sqlite_master WHERE type='table' "
                           "AND name NOT LIKE 'sqlite_%' AND name <> 'settings' ORDER BY name").fetchall()
        for (table,) in rows:
            h.update(table.encode("utf-8"))
            for row in con.execute(f'SELECT * FROM "{table}" ORDER BY 1'):
                h.update(repr(row).encode("utf-8"))
        return h.hexdigest()
    except sqlite3.Error:
        return None
    finally:
        con.close()


def read_sync_state(db_path: Path) -> Dict:
    """The fingerprint this machine last matched the folder with (pushed or pulled)."""
    try:
        state = json.loads((Path(db_path).parent / SYNC_STATE_NAME).read_text(encoding="utf-8"))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_sync_state(db_path: Path, fp: Optional[str], dest: Path, action: str,
                      extra: Optional[Dict] = None) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    state = {"fp": fp, "at": datetime.now(timezone.utc).isoformat(), "dest": str(dest), "action": action}
    state.update(extra or {})
    target = Path(db_path).parent / SYNC_STATE_NAME
    staged = target.with_suffix(".tmp")
    staged.write_text(json.dumps(state, indent=2), encoding="utf-8")
    staged.replace(target)


def _settings_rows(db_path: Path) -> Dict[str, str]:
    """The live notebook's settings rows. They are machine-local (folder paths, last-run
    summaries), so a pull takes the notebook and keeps them."""
    out: Dict[str, str] = {}
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return out
    try:
        out = dict(con.execute("SELECT key, value FROM settings"))
    except sqlite3.Error:
        pass  # an old or unreadable notebook simply has nothing to keep
    finally:
        con.close()
    return out


def _write_settings_rows(db_path: Path, rows: Dict[str, str]) -> None:
    con = sqlite3.connect(str(db_path))
    try:
        con.execute("DELETE FROM settings")
        con.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", list(rows.items()))
        con.commit()
    finally:
        con.close()


def _has_records(db_path: Path) -> bool:
    """True for a notebook with content in it - the copies worth keeping when one is replaced.

    `settings` is left out: every install has folder paths in there, and a configured-but-empty
    notebook is still empty as far as a researcher is concerned.
    """
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return False
    try:
        for (table,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                    "AND name NOT LIKE 'sqlite_%' AND name != 'settings'"):
            if con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]:
                return True
    except sqlite3.Error:
        return False
    finally:
        con.close()


def _file_names(folder: Path) -> List[str]:
    """Relative names of every file under folder, subfolders included (attachments can nest)."""
    return [str(p.relative_to(folder)) for p in sorted(folder.rglob("*")) if p.is_file()] \
        if folder.is_dir() else []


def adopt(db_path: Path, uploads_dir: Path, dest: Path) -> Dict:
    """Put the folder's notebook in this machine's data folder, and its attachments in uploads/.

    Called with the app closed only (desktop.py's startup): it replaces benchflow.db. A notebook
    with records in it is kept as benchflow-replaced-<stamp>.db rather than overwritten, the same
    convention as --import --force and --restore.
    """
    db_path, uploads_dir, dest = Path(db_path), Path(uploads_dir), Path(dest)
    remote = dest / "benchflow.db"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    local_settings = _settings_rows(db_path)
    kept = None
    db_path.parent.mkdir(parents=True, exist_ok=True)
    staged = db_path.with_name(f"benchflow-pull-{uuid.uuid4().hex}.part")
    try:
        snapshot_db(remote, staged)
        refs = collect_refs(staged)
        mirror = mirror_uploads(dest / "uploads", refs, uploads_dir)
        if mirror["missing"]:
            raise ValueError("OneDrive has not delivered all referenced attachments; reopen after syncing")
        _write_settings_rows(staged, local_settings)
        if db_path.is_file():
            kept = db_path.with_name(f"benchflow-replaced-{stamp}.db")
            snapshot_db(db_path, kept)  # preserve committed WAL records before removing sidecars
            for suffix in ("-wal", "-shm"):
                Path(str(db_path) + suffix).unlink(missing_ok=True)
        staged.replace(db_path)
    finally:
        staged.unlink(missing_ok=True)
    return {"action": "pulled", "kept": str(kept) if kept else None,
            "fp": fingerprint(db_path), "db_bytes": db_path.stat().st_size, **mirror}


def _serialized_sync(operation):
    """A separate local SQLite lock serializes UI, scheduler and CLI processes; crashes release it."""
    @wraps(operation)
    def run(db_path: Path, uploads_dir: Path, dest: Path, *args, **kwargs):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        lock = sqlite3.connect(str(Path(db_path).parent / "benchflow-sync-lock.db"), timeout=0)
        try:
            try:
                lock.execute("BEGIN IMMEDIATE")
            except sqlite3.OperationalError as error:
                raise RuntimeError("Another sync is running on this computer; try again when it finishes") from error
            try:
                return operation(db_path, uploads_dir, dest, *args, **kwargs)
            except Exception as error:
                state = read_sync_state(db_path)
                fp = state.get("fp") if state.get("dest") == str(dest) else None
                try:
                    _write_sync_state(db_path, fp, dest, "error", {"detail": str(error)})
                except OSError:
                    pass  # keep the original failure when the local disk is also unavailable
                raise
        finally:
            lock.close()
    return run


@_serialized_sync
def sync_pull(db_path: Path, uploads_dir: Path, dest: Path) -> Dict:
    """Take the folder's notebook if another computer published one this computer has not seen.

    Every branch is decided by three fingerprints: the folder's, this machine's, and the one this
    machine last matched the folder with. The folder unchanged since then means this machine is
    still the writer; both sides changed means neither overwrites the other - the folder's copy
    lands beside the live notebook as benchflow-conflict-<stamp>.db (with its attachments) and the
    researcher decides, because this app has one live notebook and no merge. An empty local
    notebook has nothing to protect, so it takes the folder's — that is how a new computer gets its
    first copy.
    """
    db_path, uploads_dir, dest = Path(db_path), Path(uploads_dir), Path(dest)
    remote = dest / "benchflow.db"
    remote_fp = fingerprint(remote)
    if remote_fp is None:
        return {"action": "nothing-to-pull", "detail": f"{remote} is not a readable notebook"}
    state = read_sync_state(db_path)
    last_fp = state.get("fp") if state.get("dest") == str(dest) else None
    local_fp = fingerprint(db_path)
    if remote_fp == last_fp or remote_fp == local_fp:
        _write_sync_state(db_path, remote_fp, dest, "up-to-date")
        return {"action": "up-to-date"}
    if local_fp is not None and local_fp != last_fp and _has_records(db_path):
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        kept = db_path.parent / f"benchflow-conflict-{stamp}.db"
        detail = ("this computer and the OneDrive folder both changed since they last matched, so "
                  "neither overwrote the other. The folder's copy is the file named below.")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(remote, kept)
        mirror = mirror_uploads(dest / "uploads", _file_names(dest / "uploads"), uploads_dir)
        # the fingerprint stays the old one: the decision table needs "what I last matched", and
        # Settings shows this record so a collision is not buried in the desktop log.
        _write_sync_state(db_path, last_fp, dest, "conflict", {"kept": str(kept), "detail": detail})
        return {"action": "conflict", "kept": str(kept), "detail": detail, **mirror}
    summary = adopt(db_path, uploads_dir, dest)
    _write_sync_state(db_path, summary["fp"], dest, "pulled")
    return summary


@_serialized_sync
def publish(db_path: Path, uploads_dir: Path, dest: Path, keep: int = HISTORY_KEEP) -> Dict:
    """Push, but only while the folder still holds what this machine last matched it with.

    A window left open across the other machine's publish would otherwise overwrite that notebook
    on its way out, and a machine that has never matched the folder cannot tell whose notebook is
    newer at all. Both are refused: this window's work goes into history/ and uploads/ (so it is
    never lost) and the researcher is told to close and reopen, which pulls or reports a conflict.
    An empty local notebook has nothing to keep, so it is not copied anywhere - it must never
    replace a folder notebook that holds records.
    """
    db_path, uploads_dir, dest = Path(db_path), Path(uploads_dir), Path(dest)
    state = read_sync_state(db_path)
    last_fp = state.get("fp") if state.get("dest") == str(dest) else None
    folder_fp = fingerprint(dest / "benchflow.db")
    if folder_fp is None and ((dest / "benchflow.db").exists() or last_fp):
        raise ValueError("The previously published notebook is missing or unreadable; wait for OneDrive before publishing")
    if folder_fp is not None and folder_fp != last_fp:
        if not _has_records(db_path):
            return {"action": "nothing-to-publish", "dest": str(dest),
                    "detail": "this notebook is empty and the OneDrive folder holds the other "
                              "computer's notebook, so nothing was copied. Close this window and "
                              "open it again to take that notebook over."}
        summary = run_backup(db_path, uploads_dir, dest, keep=keep, publish_db=False)
        summary["action"] = "conflict"
        summary["detail"] = (
            f"the OneDrive folder holds a notebook this computer has not matched"
            f"{'' if last_fp else ' (this computer has never synced with it)'}, so publishing here "
            "would replace it. Nothing was overwritten: your work is here and in history/. Close "
            "this window and open it again to take theirs or keep yours.")
        return summary
    summary = run_backup(db_path, uploads_dir, dest, keep=keep)
    _write_sync_state(db_path, summary["published_fp"], dest, "pushed")
    summary["action"] = "pushed"
    return summary


def run_configured() -> Optional[Dict]:
    """Back up to the folder configured in Settings and record the summary there, so a CLI run
    or a scheduled task reports the same "last backup" as the app. None when unconfigured.
    """
    from fastapi import HTTPException
    from sqlmodel import Session

    from app.database import engine
    from app.db_service import get_setting
    from app.main import backup_run

    try:
        with Session(engine) as session:
            if not get_setting(session, "backup_dir"):
                print("No backup folder configured (Settings > Personal OneDrive Backup); nothing to do.")
                return None
            return backup_run(session)  # app/main.py: the guarded push, so it never clobbers the other machine
    except HTTPException as e:
        print(e.detail)
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Back up the Benchflow notebook to a personal OneDrive folder")
    ap.add_argument("--dest", default=None,
                    help="Backup folder, e.g. C:\\Users\\you\\OneDrive\\BenchflowBackup "
                         "(default: the folder configured in Settings; nothing runs if none is configured)")
    ap.add_argument("--db", default=None, help="benchflow.db path (default: this app's data dir, with --dest)")
    ap.add_argument("--uploads", default=None, help="uploads dir (default: this app's uploads dir, with --dest)")
    ap.add_argument("--keep", type=int, default=HISTORY_KEEP, help="snapshots to keep in history/ (with --dest)")
    args = ap.parse_args()

    if args.dest:
        from app.paths import DB_PATH, UPLOAD_DIR

        s = publish(Path(args.db) if args.db else DB_PATH,
                       Path(args.uploads) if args.uploads else UPLOAD_DIR,
                       Path(args.dest).expanduser(), args.keep)
    else:
        s = run_configured()
    if not s:
        return
    if s.get("action") in ("conflict", "nothing-to-publish"):
        print(s["detail"])
        return
    print(
        f"backed up {s['referenced']} referenced attachments ({s['copied']} new, "
        f"{s['missing']} missing) + {s['db_bytes'] / 1024:.0f} KB db -> {s['dest']}; "
        f"{s['unreferenced_count']} unreferenced files ({s['unreferenced_bytes'] / 1e9:.2f} GB) not copied"
    )


if __name__ == "__main__":
    main()
