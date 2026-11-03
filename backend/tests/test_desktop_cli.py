"""desktop.py on the command line: one instance per account, and an import that cannot destroy a notebook.

Standalone:  python backend/tests/test_desktop_cli.py
Pytest:      pytest backend/tests

Each CLI case runs in a fresh interpreter with BENCHFLOW_DATA_DIR and BENCHFLOW_APP_DATA pointed at
a throwaway folder. app/paths.py reads its environment once, at import, and that is exactly how the
shipped app starts, so these tests drive the real thing instead of a re-imported imitation.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_DESKTOP = ROOT / "backend" / "desktop.py"
_BACKEND = ROOT / "backend"
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(ROOT))

import desktop  # noqa: E402
from desktop import (  # noqa: E402
    _empty_file,
    _live_notebook_empty,
    _notebook_in,
)

DDL = """
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, project_id TEXT, name TEXT);
"""


def _sqlite_notebook(path: Path, records: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(DDL)
    for n in range(records):
        con.execute("INSERT INTO projects (id, name) VALUES (?, ?)", (f"p{n}", f"Project {n}"))
        con.execute("INSERT INTO experiments (id, project_id, name) VALUES (?, ?, ?)",
                    (f"e{n}", f"p{n}", f"Record {n}"))
    con.commit()
    con.close()
    return path


def _web_app_folder(root: Path) -> Path:
    """A web app backend/ folder as the researcher would copy it: data/benchflow.db + uploads/."""
    (root / "data").mkdir(parents=True, exist_ok=True)
    (root / "uploads" / "figs").mkdir(parents=True, exist_ok=True)
    (root / "uploads" / "run1.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    (root / "uploads" / "figs" / "fig.png").write_bytes(b"\x89PNG fake")
    (root / "lab_state.json").write_text('{"projects": []}', encoding="utf-8")
    _sqlite_notebook(root / "data" / "benchflow.db", records=2)
    return root


def _env(home: Path) -> dict:
    return dict(os.environ, BENCHFLOW_DATA_DIR=str(home / "data"), BENCHFLOW_APP_DATA=str(home))


def _cli(*args, env: dict, timeout: int = 90):
    return subprocess.run([sys.executable, str(_DESKTOP), *[str(a) for a in args]],
                          capture_output=True, env=env, timeout=timeout)


def _out(proc) -> str:
    return proc.stdout.decode(errors="replace") + "\n" + proc.stderr.decode(errors="replace")


def _records(db: Path) -> int:
    if not db.is_file():
        return -1
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute("SELECT COUNT(*) FROM experiments").fetchone()[0]
    except sqlite3.Error:
        return -2
    finally:
        con.close()


# ------------------------------------------------------------------ the import itself


def test_an_import_lands_in_the_desktop_data_folder_and_not_in_the_code_tree():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        web = _web_app_folder(tmp / "web-backend")
        home = tmp / "desktop"

        r = _cli("--import", web, env=_env(home))

        assert r.returncode == 0, _out(r)
        assert _records(home / "data" / "benchflow.db") == 2, _out(r)
        assert (home / "data" / "lab_state.json").is_file()
        # the attachments land beside the new notebook, subfolders kept, because a record stores
        # the path relative to uploads/
        assert (home / "uploads" / "run1.csv").is_file()
        assert (home / "uploads" / "figs" / "fig.png").read_bytes() == b"\x89PNG fake"
        # one-way: the web app's own notebook and attachments are still where they were
        assert (web / "data" / "benchflow.db").is_file() and (web / "uploads" / "figs" / "fig.png").is_file()
        assert not list((home / "data").glob("benchflow-imported-*")), _out(r)


def test_an_import_refuses_to_overwrite_a_notebook_that_has_records():
    """--force must not be able to destroy a notebook someone already typed into."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        web = _web_app_folder(tmp / "web-backend")
        home = tmp / "desktop"
        mine = _sqlite_notebook(home / "data" / "benchflow.db", records=3)
        before = mine.read_bytes()

        r = _cli("--import", web, "--force", env=_env(home))

        assert r.returncode == 1, _out(r)
        assert mine.read_bytes() == before, "a notebook with records was overwritten"
        assert "records" in _out(r), _out(r)
        assert not list((home / "data").glob("benchflow-imported-*")), \
            "a refused import must not leave a partial copy behind"


def test_an_empty_file_where_the_notebook_should_be_is_not_offered_as_a_notebook():
    """A 0-byte benchflow.db from an aborted sync is not a notebook and must not block an import,
    and must not be kept as a replacement copy either."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        web = _web_app_folder(tmp / "web-backend")
        home = tmp / "desktop"
        empty = home / "data" / "benchflow.db"
        empty.parent.mkdir(parents=True, exist_ok=True)
        empty.write_bytes(b"")

        r = _cli("--import", web, env=_env(home))

        assert r.returncode == 0, _out(r)
        assert _records(empty) == 2, _out(r)
        assert not list((home / "data").glob("benchflow-replaced-*")), _out(r)


def test_the_copy_lands_beside_an_existing_notebook_instead_of_merging_into_it():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        web = _web_app_folder(tmp / "web-backend")
        home = tmp / "desktop"
        mine = _sqlite_notebook(home / "data" / "benchflow.db", records=3)
        before = mine.read_bytes()

        r = _cli("--import", web, env=_env(home))  # no --force: an existing notebook is not touched

        assert r.returncode == 0, _out(r)
        assert mine.read_bytes() == before
        copies = list((home / "data").glob("benchflow-imported-*.db"))
        assert len(copies) == 1, list((home / "data").iterdir())
        assert _records(copies[0]) == 2
        assert "force" in _out(r), "the researcher should be told how to replace deliberately"


# ------------------------------------------------------------------ one instance per account
#
# desktop.py's window mode needs pywebview, which a source-tree test run does not have, so these
# drive acquire_instance_lock() directly - the function that decides whether this process may open
# a window - with APP_DATA_DIR pointed at a throwaway folder. desktop.py reads that folder once, at
# import, so the test sets the module attribute the same way app/paths.py would have.


def _lock_folder(tmp: Path):
    """Point APP_DATA_DIR (where desktop.lock lives) at a throwaway; return what to restore."""
    previous = desktop.APP_DATA_DIR
    desktop.APP_DATA_DIR = tmp
    return previous


def test_a_lock_left_by_a_crash_does_not_wedge_startup():
    """A desktop.lock whose process is gone must not stop the next start (acceptance: restart after
    a restart loop). The pid is a real one that was killed, not an invented number."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        previous = _lock_folder(tmp)
        try:
            # a pid that really existed, with the create time a crashed instance would have
            # recorded. Windows keeps a pid allocated while any handle to it is open - including
            # the one Python holds - so the fixture closes it and waits for the pid to be gone.
            victim = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            dead, created = victim.pid, desktop._process_create_time(victim.pid)
            victim.kill()
            victim.wait(timeout=10)
            victim._handle.Close()
            assert created, "could not read the create time of a live process"
            deadline = time.monotonic() + 5.0
            while desktop._pid_alive(dead, created) and time.monotonic() < deadline:
                time.sleep(0.1)
            assert desktop._pid_alive(dead, created) is False, "the fixture did not produce a dead pid"

            # desktop.lock holds "<port> <pid> <create time>", exactly as write_instance writes it
            (tmp / "desktop.lock").write_text(f"8765 {dead} {created}", encoding="utf-8")

            handle, only_instance = desktop.acquire_instance_lock()
            assert handle is not None and only_instance is True, \
                "a dead process's lock file stopped this start"
            if handle is not None:
                os.close(handle)  # _create_exclusive hands back a raw file descriptor
            desktop.release_instance_lock()  # what shutdown() does on the way out
        finally:
            desktop.APP_DATA_DIR = previous


def test_an_empty_lock_file_does_not_wedge_startup():
    """_create_exclusive creates desktop.lock empty and write_instance fills it in later, so a
    process killed in between leaves a blank file. Unreadable contents are not proof that another
    instance owns the app - taking over is the only way the app can ever open again."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        previous = _lock_folder(tmp)
        try:
            (tmp / "desktop.lock").write_text("", encoding="utf-8")

            handle, only_instance = desktop.acquire_instance_lock()
            assert handle is not None and only_instance is True, \
                "an empty desktop.lock stopped this start"
            if handle is not None:
                os.close(handle)
            desktop.release_instance_lock()
        finally:
            desktop.APP_DATA_DIR = previous


def test_a_second_instance_does_not_take_over_from_the_first():
    """A live process that still answers /api/health owns the app: the second start must not open
    a window or start a server, it brings the first one to the front instead."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        previous = _lock_folder(tmp)
        healthy = desktop._healthy
        try:
            created = desktop._process_create_time(os.getpid())
            assert created is not None
            (tmp / "desktop.lock").write_text(f"8765 {os.getpid()} {created}", encoding="utf-8")
            desktop._healthy = lambda port: True  # this test has no HTTP server of its own

            handle, only_instance = desktop.acquire_instance_lock()
            assert handle is None and only_instance is False, \
                "a second instance claimed an app a live instance already owns"
        finally:
            desktop._healthy = healthy
            desktop.APP_DATA_DIR = previous


# ------------------------------------------------------------------ the small decisions


def test_a_file_created_by_accident_is_still_treated_as_empty():
    with tempfile.TemporaryDirectory() as tmp:
        blank = Path(tmp) / "benchflow.db"
        assert _empty_file(blank) is False  # not there yet: the caller takes the no-notebook path
        blank.write_bytes(b"")
        assert _empty_file(blank) is True   # 0 bytes is not a notebook, whatever it is called
        blank.write_bytes(b"\x00\x00\x10\x00sqlite format 3")
        assert _empty_file(blank) is False
        assert _empty_file(Path(__file__)) is False


def test_a_notebook_with_records_is_not_empty_and_an_untouched_one_is():
    with tempfile.TemporaryDirectory() as tmp:
        assert _live_notebook_empty(_sqlite_notebook(Path(tmp) / "a.db", records=0)) is True
        assert _live_notebook_empty(_sqlite_notebook(Path(tmp) / "b.db", records=2)) is False
        assert _live_notebook_empty(Path(tmp) / "d.db") is False  # absent is not "empty"
        # bytes that are not a database at all - an interrupted download - are never offered as
        # "the empty notebook", because replacing them would destroy whatever they are
        (Path(tmp) / "c.db").write_bytes(b"SQLite format 3\x00" + b"\x00" * 4096)
        assert _live_notebook_empty(Path(tmp) / "c.db") is False


def test_the_source_of_an_import_is_a_local_folder_and_a_network_share_is_refused():
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / "lab-notebook"
        local.mkdir()
        assert _notebook_in(local) is True
        assert _notebook_in(Path("C:/Users/bryce/lab-notebook")) is True
        assert _notebook_in(Path("C:/Users/bryce/lab-notebook").resolve()) is True
        assert _notebook_in(Path("\\\\shar\\lab\\lab-notebook")) is False
        assert _notebook_in(Path("//shar/lab/lab-notebook")) is False


def test_the_window_keeps_its_profile_and_binds_only_to_loopback():
    """Two settings in desktop.py that look arbitrary and break real things.

    private_mode=True turns on WebView2's InPrivate mode, which keeps localStorage in memory:
    every preference the web app stores (sidebar width, calendar tray, snap-to-grid) would
    vanish on restart. A host that is not loopback would put a private notebook on the LAN."""
    source = _DESKTOP.read_text(encoding="utf-8")
    assert "private_mode=False" in source, \
        "WebView2 must keep its profile, or the UI's localStorage preferences are lost"
    assert 'host="127.0.0.1"' in source and "0.0.0.0" not in source, \
        "the API must be reachable from this machine only"


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
        print("test_desktop_cli FAILED: " + ", ".join(failed))
        sys.exit(1)
    print("test_desktop_cli passed")
