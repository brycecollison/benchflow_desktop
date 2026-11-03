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

Run on demand (no --dest: use the folder configured in Settings, which is what the dev
launcher and a scheduled task should do, so they all update the app's "last backup"):
    python -m app.backup
    python -m app.backup --dest C:\\Users\\you\\OneDrive\\BenchflowBackup
"""

import argparse
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from sqlmodel import Session, create_engine

from app.sharepoint_export import APP_VERSION, extract_refs

HISTORY_KEEP = 14


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
    """Copy referenced files that are missing from, or differ in size at, the destination."""
    dest_uploads.mkdir(parents=True, exist_ok=True)
    copied = present = missing = 0
    for name in sorted(refs):
        src = uploads_dir / name
        if not src.exists():
            missing += 1
            continue
        dst = dest_uploads / name
        if dst.exists() and dst.stat().st_size == src.stat().st_size:
            present += 1
            continue
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


def run_backup(db_path: Path, uploads_dir: Path, dest: Path, keep: int = HISTORY_KEEP) -> Dict:
    """Write a snapshot + attachment mirror under dest. Returns the summary."""
    db_path, uploads_dir, dest = Path(db_path), Path(uploads_dir), Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    history = dest / "history"
    history.mkdir(parents=True, exist_ok=True)

    refs = collect_refs(db_path)
    db_bytes = snapshot_db(db_path, dest / "benchflow.db")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snapshot_db(db_path, history / f"benchflow-{stamp}.db")
    removed = rotate(history, keep)

    mirror = mirror_uploads(uploads_dir, refs, dest / "uploads")
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
        "unreferenced_count": len(extras),
        "unreferenced_bytes": sum(e["size"] for e in extras),
        "unreferenced": extras[:200],
    }
    (dest / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
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
            return backup_run(session)
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

        s = run_backup(Path(args.db) if args.db else DB_PATH,
                       Path(args.uploads) if args.uploads else UPLOAD_DIR,
                       Path(args.dest).expanduser(), args.keep)
    else:
        s = run_configured()
    if not s:
        return
    print(
        f"backed up {s['referenced']} referenced attachments ({s['copied']} new, "
        f"{s['missing']} missing) + {s['db_bytes'] / 1024:.0f} KB db -> {s['dest']}; "
        f"{s['unreferenced_count']} unreferenced files ({s['unreferenced_bytes'] / 1e9:.2f} GB) not copied"
    )


if __name__ == "__main__":
    main()
