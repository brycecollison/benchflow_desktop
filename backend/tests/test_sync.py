"""Self-checks for the OneDrive folder acting as a sync instead of only an archive.

Runs standalone (no pytest needed):
    python tests/test_sync.py

The decision under test is the one that can lose a notebook, so every case checks what happened
to *both* copies, not just the summary: the live notebook and the folder's benchflow.db.

BENCHFLOW_DATA_DIR/BENCHFLOW_UPLOAD_DIR are pointed at a temp folder before app.main is imported,
so the real notebook is never opened.
"""

import os
import shutil
import sqlite3
import sys
import tempfile
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TMP = Path(tempfile.mkdtemp(prefix="benchflow_sync_"))
os.environ["BENCHFLOW_DATA_DIR"] = str(TMP / "data")
os.environ["BENCHFLOW_UPLOAD_DIR"] = str(TMP / "uploads")

import app.paths  # noqa: E402  (must see the env above)
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

from app.backup import (  # noqa: E402
    SYNC_STATE_NAME,
    adopt,
    configured_dest,
    fingerprint,
    publish,
    read_sync_state,
    sync_pull,
)
from app.models import ExperimentDB  # noqa: E402


def _notebook(path: Path, tag: str, count: int = 1) -> Path:
    """A notebook with `count` experiments, named after `tag`, one attachment referenced."""
    path.parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(f"sqlite:///{path}")
    SQLModel.metadata.create_all(eng)
    with Session(eng) as s:
        for i in range(count):
            s.add(ExperimentDB(id=f"{tag}-{i}", project_id="pr1", name=f"{tag} exp {i}",
                               results=f"[![i](/uploads/{tag}_preview.png)](#z)"))
        s.commit()
    eng.dispose()
    return path


def _case() -> tuple:
    """A machine (db + uploads) and the sync folder it is configured to use."""
    root = Path(tempfile.mkdtemp(prefix="benchflow_sync_case_"))
    db, up, dest = root / "benchflow.db", root / "uploads", root / "OneDrive" / "BenchflowBackup"
    _notebook(db, "mine")
    up.mkdir()
    (up / "mine_preview.png").write_bytes(b"m" * 40)
    (dest / "uploads").mkdir(parents=True)
    con = sqlite3.connect(db)                      # the folder is configured, as in Settings
    con.execute("INSERT INTO settings (key, value) VALUES ('backup_dir', ?)", (str(dest),))
    con.commit()
    con.close()
    return root, db, up, dest


def _count(db: Path, like: str) -> int:
    """Closing matters: an open connection holds the file, and Windows refuses to move it."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute("SELECT COUNT(*) FROM experiments WHERE name LIKE ?", (like,)).fetchone()[0]
    finally:
        con.close()


def _settings(db: Path) -> dict:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return dict(con.execute("SELECT key, value FROM settings"))
    finally:
        con.close()


def _other_machine_publishes(dest: Path, up: Path, count: int = 2) -> None:
    """What OneDrive delivers between two looks: the other computer's notebook and its uploads."""
    staging = _notebook(dest / "theirs.db", "theirs", count)
    (dest / "uploads" / "theirs_preview.png").write_bytes(b"t" * 30)
    shutil.copy2(staging, dest / "benchflow.db")
    staging.unlink()


def test_fingerprint_ignores_settings_and_refuses_placeholders():
    root, db, _up, dest = _case()
    try:
        fp = fingerprint(db)
        assert fp and fingerprint(db) == fp
        con = sqlite3.connect(db)  # folder paths are machine-local, not a notebook change
        con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_dir', ?)", (str(dest),))
        con.commit()
        con.close()
        assert fingerprint(db) == fp

        assert fingerprint(dest / "benchflow.db") is None          # nothing published yet
        (dest / "benchflow.db").write_bytes(b"")                   # OneDrive's online-only placeholder
        assert fingerprint(dest / "benchflow.db") is None
        (dest / "benchflow.db").write_bytes(b"not a database at all")  # half-copied file
        assert fingerprint(dest / "benchflow.db") is None
        assert fingerprint(root / "nope.db") is None
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_publish_then_pull_takes_the_other_notebook_and_keeps_local_settings():
    root, db, up, dest = _case()
    try:
        local_fp = fingerprint(db)

        s = publish(db, up, dest)
        assert s["action"] == "pushed" and s["published"] and s["copied"] == 1
        assert fingerprint(dest / "benchflow.db") == local_fp
        assert read_sync_state(db)["fp"] == local_fp
        assert configured_dest(db) == dest

        _other_machine_publishes(dest, up)
        s = sync_pull(db, up, dest)
        assert s["action"] == "pulled", s

        assert _count(db, "theirs%") == 2 and _count(db, "mine%") == 0  # folder's notebook is live now
        assert _settings(db) == {"backup_dir": str(dest)}               # paths stayed this machine's
        assert (up / "theirs_preview.png").is_file()          # its attachments came along
        assert (up / "mine_preview.png").is_file()            # and nothing of ours was deleted
        kept = Path(s["kept"])
        assert kept.name.startswith("benchflow-replaced-") and _count(kept, "mine%") == 1
        assert read_sync_state(db)["fp"] == fingerprint(db)   # matched, so the next push is allowed
        assert sync_pull(db, up, dest)["action"] == "up-to-date"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_both_changed_keeps_both_copies():
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        base = read_sync_state(db)["fp"]
        _other_machine_publishes(dest, up)                    # the other computer published
        _notebook(db.parent / "edited.db", "mine", 3).replace(db)  # and this window edited on top

        folder_before, local_before = fingerprint(dest / "benchflow.db"), fingerprint(db)
        s = sync_pull(db, up, dest)
        assert s["action"] == "conflict", s

        assert fingerprint(dest / "benchflow.db") == folder_before  # neither copy touched
        assert fingerprint(db) == local_before
        kept = Path(s["kept"])
        assert kept.name.startswith("benchflow-conflict-") and _count(kept, "theirs%") == 2
        assert (up / "theirs_preview.png").is_file()          # the kept copy's attachments are usable
        # the record says conflict and still names the old baseline: the next push must keep refusing
        assert read_sync_state(db)["action"] == "conflict" and read_sync_state(db)["fp"] == base
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_push_after_the_folder_changed_is_refused():
    """A window open across the other machine's publish must not overwrite it on its way out."""
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        _other_machine_publishes(dest, up)                    # published while this window was open
        folder_fp = fingerprint(dest / "benchflow.db")

        s = publish(db, up, dest)
        assert s["action"] == "conflict" and not s["published"] and "history" in s
        assert fingerprint(dest / "benchflow.db") == folder_fp        # the other notebook survives
        snaps = sorted((dest / "history").glob("benchflow-*.db"))
        assert snaps and fingerprint(snaps[-1]) == fingerprint(db)  # this window's work is kept
        assert read_sync_state(db)["fp"] != folder_fp         # baseline untouched: still refusing
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_empty_notebook_never_wipes_the_folder():
    """A fresh install pointed at a folder that already holds a notebook must not push over it."""
    root, db, up, dest = _case()
    try:
        db.unlink()                                          # what a fresh install looks like
        _notebook(db, "empty", 0)                            # seeded, but nothing typed yet
        (up / "mine_preview.png").unlink()
        _other_machine_publishes(dest, up)                    # the folder holds the other machine's work

        folder_fp = fingerprint(dest / "benchflow.db")
        snaps_before = len(list((dest / "history").glob("benchflow-*.db")))
        s = publish(db, up, dest)
        assert s["action"] == "nothing-to-publish", s
        assert fingerprint(dest / "benchflow.db") == folder_fp
        assert len(list((dest / "history").glob("benchflow-*.db"))) == snaps_before  # empty, nothing to keep
        assert read_sync_state(db) == {}                      # nothing matched, so nothing claimed
        assert sync_pull(db, up, dest)["action"] == "pulled"  # reopening takes it over instead
        assert _count(db, "theirs%") == 2
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_pull_survives_a_missing_or_half_synced_folder():
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        (dest / "benchflow.db").unlink()
        assert sync_pull(db, up, dest)["action"] == "nothing-to-pull"
        assert fingerprint(db) is not None and db.is_file()

        shutil.rmtree(dest)                                   # the folder went away (drive offline)
        assert sync_pull(db, up, dest)["action"] == "nothing-to-pull"
        assert configured_dest(db) == dest                    # the setting is not silently dropped
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_adopt_replaces_the_live_notebook_once():
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        _other_machine_publishes(dest, up, count=3)
        pushed_fp = read_sync_state(db)["fp"]
        first = adopt(db, up, dest)
        assert _count(db, "theirs%") == 3 and Path(first["kept"]).name.startswith("benchflow-replaced-")
        for suffix in ("-wal", "-shm"):                       # an open notebook's side files are gone
            assert not Path(str(db) + suffix).exists()
        assert read_sync_state(db)["fp"] == pushed_fp         # adopt records nothing: sync_pull does
        second = adopt(db, up, dest)                          # pulled again for some reason
        assert _count(second["kept"], "theirs%") == 3         # a copy with records is never discarded
        assert Path(second["kept"]).name.startswith("benchflow-replaced-")
        assert SYNC_STATE_NAME in [p.name for p in db.parent.iterdir()]
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_the_backup_command_reports_a_refusal_as_a_failure():
    """`--backup` runs from a scheduled task with no console to read, so the exit code is the only
    thing that can tell a sync from a refusal."""
    import desktop
    from app import backup as backup_module

    real = backup_module.run_configured
    try:
        for action in ("conflict", "nothing-to-publish"):
            backup_module.run_configured = lambda: {"action": action, "detail": f"refused: {action}"}
            assert desktop.run_backup_mode() == 1, action
        backup_module.run_configured = lambda: {"action": "published", "detail": "ok"}
        assert desktop.run_backup_mode() == 0
    finally:
        backup_module.run_configured = real


def test_parallel_sync_is_refused_and_lock_is_released():
    root, db, up, dest = _case()
    try:
        lock = sqlite3.connect(root / "benchflow-sync-lock.db")
        lock.execute("BEGIN IMMEDIATE")
        try:
            for operation in (publish, sync_pull):
                with pytest.raises(RuntimeError, match="Another sync"):
                    operation(db, up, dest)
        finally:
            lock.close()
        assert publish(db, up, dest)["action"] == "pushed"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_unreadable_remote_is_never_overwritten():
    root, db, up, dest = _case()
    try:
        remote = dest / "benchflow.db"
        remote.write_bytes(b"partial transfer")
        with pytest.raises(ValueError, match="unreadable"):
            publish(db, up, dest)
        assert remote.read_bytes() == b"partial transfer"
        remote.unlink()
        publish(db, up, dest)
        remote.unlink()
        with pytest.raises(ValueError, match="missing"):
            publish(db, up, dest)
        assert not remote.exists()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_pull_missing_attachments_keeps_live_notebook_and_baseline():
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        before, state = fingerprint(db), read_sync_state(db)
        _other_machine_publishes(dest, up)
        (dest / "uploads" / "theirs_preview.png").unlink()
        with pytest.raises(ValueError, match="attachments"):
            sync_pull(db, up, dest)
        assert fingerprint(db) == before
        assert read_sync_state(db)["fp"] == state["fp"]
        assert read_sync_state(db)["action"] == "error"
        assert "attachments" in read_sync_state(db)["detail"]
        assert not list(root.glob("*.part"))
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_pull_drops_remote_machine_settings():
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        _other_machine_publishes(dest, up)
        con = sqlite3.connect(dest / "benchflow.db")
        con.execute("INSERT INTO settings (key, value) VALUES ('foreign_path', 'C:/other-machine')")
        con.commit()
        con.close()
        sync_pull(db, up, dest)
        assert _settings(db) == {"backup_dir": str(dest)}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_attachment_collisions_and_nested_paths():
    from app.backup import mirror_uploads
    root, db, up, dest = _case()
    try:
        (dest / "uploads" / "mine_preview.png").write_bytes(b"x" * 40)
        with pytest.raises(ValueError, match="collision"):
            mirror_uploads(up, ["mine_preview.png"], dest / "uploads")
        assert (up / "mine_preview.png").read_bytes() == b"m" * 40
        assert (dest / "uploads" / "mine_preview.png").read_bytes() == b"x" * 40
        (up / "nested").mkdir()
        (up / "nested" / "file.txt").write_text("hello")
        mirror_uploads(up, ["nested/file.txt"], dest / "uploads")
        assert (dest / "uploads" / "nested" / "file.txt").read_text() == "hello"
        with pytest.raises(ValueError, match="escapes"):
            mirror_uploads(up, ["../benchflow.db"], dest / "uploads")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_adopt_preserves_committed_wal_records():
    import subprocess
    root, db, up, dest = _case()
    try:
        _other_machine_publishes(dest, up)
        subprocess.run([sys.executable, "-c",
                        "import sqlite3, os, sys; c=sqlite3.connect(sys.argv[1]); "
                        "c.execute('PRAGMA journal_mode=WAL'); "
                        "c.execute(\"UPDATE experiments SET name='committed in WAL'\"); "
                        "c.commit(); os._exit(0)", str(db)], check=True)
        assert Path(str(db) + "-wal").exists()
        result = adopt(db, up, dest)
        assert _count(Path(result["kept"]), "committed in WAL") == 1
        assert _count(db, "theirs%") == 2
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_adopt_failure_does_not_remove_live_database():
    from unittest.mock import patch
    root, db, up, dest = _case()
    try:
        publish(db, up, dest)
        _other_machine_publishes(dest, up)
        before = fingerprint(db)
        with patch("app.backup._write_settings_rows", side_effect=OSError("disk full")):
            with pytest.raises(OSError):
                adopt(db, up, dest)
        assert fingerprint(db) == before
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _run() -> None:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(fns)} tests passed")


if __name__ == "__main__":
    _run()
    shutil.rmtree(TMP, ignore_errors=True)
