"""Self-checks for the personal OneDrive backup.

Runs standalone (no pytest needed):
    python tests/test_backup.py

BENCHFLOW_DATA_DIR/BENCHFLOW_UPLOAD_DIR are pointed at a temp folder before app.main is
imported, so the user's real notebook is never opened (that is exactly what app/paths.py
makes possible).
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TMP = Path(tempfile.mkdtemp(prefix="benchflow_backup_"))
os.environ["BENCHFLOW_DATA_DIR"] = str(TMP / "data")
os.environ["BENCHFLOW_UPLOAD_DIR"] = str(TMP / "uploads")

import app.paths  # noqa: E402  (must see the env above)
from fastapi import HTTPException  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

from app.backup import rotate, run_backup  # noqa: E402
from app.models import ExperimentDB  # noqa: E402


def _notebook(root: Path) -> Path:
    """A notebook db at root/benchflow.db with one experiment using two attachments."""
    db = root / "benchflow.db"
    eng = create_engine(f"sqlite:///{db}")
    SQLModel.metadata.create_all(eng)
    with Session(eng) as s:
        s.add(ExperimentDB(
            id="e1", project_id="pr1", name="Exp",
            results='[![i](/uploads/aaaa1111_img_preview.png)](#z)',
            blocks=[{"type": "img", "name": "raw", "src": "/uploads/aaaa1111_img.tif"}],
        ))
        s.commit()
    eng.dispose()
    return db


def _env() -> tuple:
    root = Path(tempfile.mkdtemp(prefix="benchflow_backup_case_"))
    db = _notebook(root)
    up = root / "uploads"
    up.mkdir()
    (up / "aaaa1111_img.tif").write_bytes(b"x" * 100)
    (up / "aaaa1111_img_preview.png").write_bytes(b"y" * 50)
    (up / "zzz_unreferenced.nd2").write_bytes(b"z" * 200)
    return root, db, up


def test_paths_env_override():
    assert app.paths.DATA_DIR == TMP / "data"
    assert app.paths.UPLOAD_DIR == TMP / "uploads"
    assert app.paths.DB_PATH == TMP / "data" / "benchflow.db"


def test_backup_snapshot_mirror_manifest():
    root, db, up = _env()
    try:
        dest = root / "OneDrive" / "BenchflowBackup"
        s = run_backup(db, up, dest, keep=3)

        assert (dest / "benchflow.db").exists()
        with sqlite3.connect(dest / "benchflow.db") as con:
            assert con.execute("SELECT count(*) FROM experiments").fetchone()[0] == 1

        man = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
        assert {a["name"] for a in man["unreferenced"]} == {"zzz_unreferenced.nd2"}
        assert (dest / "uploads" / "aaaa1111_img.tif").stat().st_size == 100
        assert (dest / "uploads" / "aaaa1111_img_preview.png").exists()
        assert not (dest / "uploads" / "zzz_unreferenced.nd2").exists()
        assert s["referenced"] == 2 and s["copied"] == 2 and s["missing"] == 0
        assert s["unreferenced_count"] == 1 and s["unreferenced_bytes"] == 200
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_backup_repeat_is_incremental_and_append_only():
    root, db, up = _env()
    try:
        dest = root / "backup"
        run_backup(db, up, dest, keep=3)
        second = run_backup(db, up, dest, keep=3)
        assert second["copied"] == 0 and second["present"] == 2

        (up / "aaaa1111_img.tif").unlink()  # data loss on the local disk
        third = run_backup(db, up, dest, keep=3)
        assert third["missing"] == 1
        assert (dest / "uploads" / "aaaa1111_img.tif").exists()  # mirror never deletes
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_rotate_keeps_newest():
    root = Path(tempfile.mkdtemp(prefix="benchflow_hist_"))
    try:
        for stamp in ("20260101-000001", "20260102-000002", "20260103-000003",
                      "20260104-000004", "20260105-000005"):
            (root / f"benchflow-{stamp}.db").write_bytes(b"x")
        assert rotate(root, 2) == 3
        assert [p.name for p in sorted(root.glob("*.db"))] == [
            "benchflow-20260104-000004.db", "benchflow-20260105-000005.db"]
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_dest_inside_code_tree_is_refused():
    from app.main import _backup_dest_or_400

    inside = app.paths.BASE_DIR / "backup"          # backend/backup
    try:
        _backup_dest_or_400(str(inside))
        raise AssertionError("expected HTTPException for a backup folder inside the code tree")
    except HTTPException as e:
        assert e.status_code == 400 and "code folder" in e.detail

    for bad in ("", "   ", "https://x.sharepoint.com/sites/lab/BENCHFLOW"):
        try:
            _backup_dest_or_400(bad)
            raise AssertionError(f"expected HTTPException for {bad!r}")
        except HTTPException:
            pass


def test_in_onedrive_detection():
    """The OneDrive check must work with a stale environment block and mixed case, and must
    not be fooled by a same-prefix sibling (C:\\OneDriveBackup is not inside C:\\OneDrive)."""
    from app.main import _in_onedrive, _under

    root = TMP / "OD"
    saved = {k: os.environ.pop(k, None) for k in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial")}
    os.environ["OneDrive"] = str(root)
    try:
        assert _in_onedrive(root / "BenchflowBackup")
        assert _in_onedrive(TMP / "OD" / "a" / "b")
        assert not _in_onedrive(TMP / "data")
        assert _under(str(root / "x"), str(root))
        assert _under(str(root).upper(), str(root))          # case-insensitive on Windows
        assert not _under(str(root) + "Backup", str(root))   # sibling with the same prefix
        assert not _under(app.paths.BASE_DIR, root)
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


def _run() -> None:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(fns)} tests passed")


if __name__ == "__main__":
    _run()
    shutil.rmtree(TMP, ignore_errors=True)
