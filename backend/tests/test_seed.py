"""First-run seeding and the one-time notebook import, against a copy of a real notebook.

Standalone:  python backend/tests/test_seed.py
Pytest:      pytest backend/tests

The source is a throwaway folder built here (db under data/, attachments under uploads/), so
the test exercises the same folder shapes the plan names - C:\\Users\\bryce\\lab-notebook and
C:\\Users\\bryce\\Downloads\\lab-notebook (2) - and neither the web app's notebook nor this
build's own is ever opened for writing. import_notebook takes its destination explicitly for
exactly that reason.
"""
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import seed  # noqa: E402
from app.db_service import get_setting, set_setting  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

DDL = """
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER DEFAULT 0,
                       created_at TEXT, updated_at TEXT);
CREATE TABLE experiments (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, status TEXT,
                          blocks TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
"""


def _write_source(root: Path) -> Path:
    """A folder that looks like a copied-off web app: data/benchflow.db, uploads/, lab_state.json."""
    data, uploads = root / "data", root / "uploads"
    data.mkdir(parents=True, exist_ok=True)
    (uploads / "figures").mkdir(parents=True, exist_ok=True)
    (uploads / "run1.csv").write_bytes(b"exp,value\n1,2\n")
    (uploads / "figures" / "fig.png").write_bytes(b"\x89PNG fake")
    (root / "lab_state.json").write_text('{"papers": [], "projects": []}', encoding="utf-8")

    con = sqlite3.connect(data / "benchflow.db")
    con.executescript(DDL)
    con.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Circuit Lab')")
    con.execute("INSERT INTO projects (id, name) VALUES ('p2', 'Optics')")
    # one record named by its researcher, one that arrived with no name of its own
    con.execute("INSERT INTO experiments (id, project_id, name, blocks) "
                "VALUES ('e1', 'p1', 'Hall effect at 4 K', '[]')")
    con.execute("INSERT INTO experiments (id, project_id, name, blocks) "
                "VALUES ('e2', 'p2', '', '[{\"type\":\"image\",\"attachments\":[{\"name\":\"fig.png\"}]}]')")
    con.commit()
    con.close()
    return root


def _dest(tmp: str) -> Path:
    dest = Path(tmp) / "data"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def _names(db: Path) -> list:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return sorted(con.execute("SELECT name FROM experiments ORDER BY id").fetchall())
    finally:
        con.close()


def test_import_makes_the_copy_the_live_notebook():
    with tempfile.TemporaryDirectory() as tmp:
        src = _write_source(Path(tmp) / "lab-notebook")
        dest = _dest(tmp)

        summary = seed.import_notebook(src, dest_dir=dest)

        assert summary["live"] is True, summary
        assert Path(summary["db"]) == dest / "benchflow.db"
        assert summary["experiments"] == 2
        assert summary["copied"] == 2 and summary["present"] == 0
        assert summary["state_file"] is True
        # uploads land beside the data folder, with subfolders kept, because the record stores
        # the path relative to uploads/
        uploads = Path(summary["uploads_dir"])
        assert uploads == Path(tmp) / "uploads"
        assert (uploads / "run1.csv").read_bytes() == b"exp,value\n1,2\n"
        assert (uploads / "figures" / "fig.png").read_bytes() == b"\x89PNG fake"
        assert (dest / "lab_state.json").is_file()
        # the source is only read: the web app's own folders are untouched
        assert (src / "data" / "benchflow.db").is_file()
        assert (src / "uploads" / "run1.csv").is_file()


def test_import_records_the_project_name_on_a_record_that_had_none():
    """The plan's backfill: the notebook has to answer "which project?" from its own data."""
    with tempfile.TemporaryDirectory() as tmp:
        src = _write_source(Path(tmp) / "lab-notebook")
        dest = _dest(tmp)

        summary = seed.import_notebook(src, dest_dir=dest)

        assert summary["backfilled_names"] == 1, summary
        assert _names(dest / "benchflow.db") == [("Hall effect at 4 K",), ("Optics",)]


def test_a_landing_next_to_an_existing_notebook_is_beside_it_not_merged():
    """No notebook yet -> live. Notebook present -> the copy waits in a separate file."""
    with tempfile.TemporaryDirectory() as tmp:
        src = _write_source(Path(tmp) / "lab-notebook")
        dest = _dest(tmp)
        seed.import_notebook(src, dest_dir=dest)
        live_before = (dest / "benchflow.db").read_bytes()

        again = seed.import_notebook(src, dest_dir=dest)

        assert again["live"] is False, again
        assert (dest / "benchflow.db").read_bytes() == live_before
        copies = [p.name for p in dest.glob("benchflow-imported-*.db")]
        assert len(copies) == 1, list(dest.iterdir())


def test_force_keeps_the_notebook_it_replaces():
    with tempfile.TemporaryDirectory() as tmp:
        src = _write_source(Path(tmp) / "lab-notebook")
        dest = _dest(tmp)
        seed.import_notebook(src, dest_dir=dest)
        (dest / "benchflow.db").write_bytes(b"my own notebook")  # pretend this is the researcher's
        (dest.parent / "uploads").mkdir(parents=True, exist_ok=True)
        (dest.parent / "uploads" / "old.png").write_bytes(b"old")

        summary = seed.import_notebook(src, dest_dir=dest, force=True)

        assert summary["live"] is True, summary
        assert Path(summary["db"]) == dest / "benchflow.db"
        kept = Path(summary["replaced_db"])
        assert kept.is_file() and kept.read_bytes() == b"my own notebook"
        moved = Path(summary["replaced_uploads"])
        assert moved.name.startswith("uploads-replaced-") and (moved / "old.png").is_file()
        assert _names(dest / "benchflow.db") == [("Hall effect at 4 K",), ("Optics",)]


def test_a_folder_without_a_notebook_is_refused_by_name():
    with tempfile.TemporaryDirectory() as tmp:
        try:
            seed.import_notebook(Path(tmp) / "photos", dest_dir=_dest(tmp))
        except ValueError as e:
            assert "benchflow.db" in str(e)
        else:
            raise AssertionError("a folder with no benchflow.db must raise, not import nothing")


def test_the_sync_settings_are_created_once_and_never_overwritten():
    """The folder browser and `--backup` read the same rows, so they must exist and must not be
    reset by a later start."""
    with tempfile.TemporaryDirectory() as tmp:
        # its own engine on its own file: this must never open the researcher's notebook
        engine = create_engine(f"sqlite:///{Path(tmp) / 'probe.db'}")
        SQLModel.metadata.create_all(engine)

        with Session(engine) as session:
            assert get_setting(session, "backup_dir") is None
            created = seed.ensure_desktop_defaults(session)
            assert "backup_dir" in created
            assert set(seed.CONFIG_SETTING_KEYS) <= set(created)
            assert get_setting(session, "backup_dir") == ""
            set_setting(session, "backup_dir", str(Path(tmp) / "backups"))
            assert seed.ensure_desktop_defaults(session) == []
            assert get_setting(session, "backup_dir") == str(Path(tmp) / "backups")
        engine.dispose()  # Windows: the temp folder cannot go away while sqlite holds the file


if __name__ == "__main__":
    failed = []
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok  {name}")
            except Exception as exc:  # noqa: BLE001
                failed.append(name)
                import traceback
                print(f"FAIL {name}\n{traceback.format_exc()}")
    if failed:
        print("test_seed FAILED: " + ", ".join(failed))
        sys.exit(1)
    print("test_seed passed")
