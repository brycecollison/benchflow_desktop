"""How the periodic backup behaves (plan 3.1, acceptance: a backup written while the app was
running appears in <backup folder>\\history as benchflow-YYYYMMDD-HHMMSS.db).

Two halves, tested separately because they are separate risks:

  - `backup_tick` runs for real. It goes through app.backup.run_configured, which reads the same
    `backup_dir` row that Settings -> Browse writes - so there is no second setting that the
    schedule and the UI could disagree about (the bug class plan 3.1 names). test_backup.py covers
    run_configured's own folder handling; what is checked here is that the scheduled path reaches
    that folder and writes a dated snapshot.
  - The loop is checked with a short interval and a stub tick, because its job is timing: tick on
    an interval, survive a failing backup (a drive that went away must not stop the app), and stop
    when the window closes.

`import app.main` creates tables and seeds the database it is pointed at, so these tests refuse to
run unless BENCHFLOW_DATA_DIR names a throwaway folder - otherwise they would open the researcher's
real notebook. pytest does that for you (backend/tests/conftest.py); run it standalone as

    BENCHFLOW_DATA_DIR=$(mktemp -d) venv/Scripts/python.exe backend/tests/test_backup_schedule.py
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

for _candidate in (Path(__file__).resolve().parents[2], Path(__file__).resolve().parent.parent):
    if str(_candidate) not in sys.path:
        sys.path.insert(0, str(_candidate))

if not os.environ.get("BENCHFLOW_DATA_DIR"):
    raise SystemExit(
        "refusing to run: BENCHFLOW_DATA_DIR is not set, and `import app.main` would seed the real "
        "notebook. Use pytest (backend/tests/conftest.py sets it) or point it at a throwaway folder."
    )

from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

from app import database as database_module  # noqa: E402
from app import main  # noqa: E402
from app.db_service import set_setting  # noqa: E402
from app.models import ExperimentDB, ProjectDB  # noqa: E402


def _own_engine(data_dir: Path, db_name: str = "schedule-test.db"):
    """A notebook of our own on its own file, so this test's rows and the rest of the suite's never
    mix. Callers that hand the file to another process dispose() it first - sqlite locks the file."""
    db_path = data_dir / db_name
    data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(ProjectDB(id="pr1", name="Circuit lab"))
        # one record named by its researcher, one whose only claim on disk is an attachment
        session.add(ExperimentDB(id="e1", project_id="pr1", name="Crispr guide RNA library design",
                                 results="draft"))
        session.add(ExperimentDB(id="e2", project_id="pr1", name="Look at the micrograph",
                                 results="![m](/uploads/micrograph-01.png)"))
        session.commit()
    return db_path, engine


def _attachment(uploads: Path) -> Path:
    uploads.mkdir(parents=True, exist_ok=True)
    path = uploads / "micrograph-01.png"
    path.write_bytes(b"\x89PNG" + b"0" * 600_000)
    return path


def test_a_scheduled_backup_lands_in_the_history_folder_of_the_configured_folder():
    """Settings wrote `backup_dir`; the schedule must back up into that folder, with the dated copy
    under history/ - the file acceptance #9 looks for."""
    tmp = Path(tempfile.mkdtemp(prefix="benchflow-schedule-"))
    original = main.DB_PATH, main.UPLOAD_DIR, database_module.engine
    engine = None
    try:
        db_path, engine = _own_engine(tmp)
        uploads = tmp / "uploads"  # beside the data folder, the shape the app itself uses
        _attachment(uploads)
        backup = tmp / "backup"
        with Session(engine) as session:
            set_setting(session, "backup_dir", str(backup))

        # backup_run takes the paths off main's module globals, exactly as the running app has them
        main.DB_PATH, main.UPLOAD_DIR, database_module.engine = db_path, uploads, engine
        summary = main.backup_tick()

        assert summary is not None, "a configured folder did not produce a backup"
        snapshots = sorted((backup / "history").glob("benchflow-*.db"))
        assert snapshots, f"nothing written under {backup / 'history'}"
        stamp = snapshots[0].name[len("benchflow-"):-len(".db")]
        assert len(stamp) == len("20260729-091126-123456-1234abcd") and stamp[8] == "-", snapshots[0].name
        assert (backup / "benchflow.db").is_file()
        assert (backup / "uploads" / "micrograph-01.png").is_file(), \
            "an attachment the notebook references must be in the backup"
        assert (backup / "manifest.json").is_file()

        # and with no folder configured the schedule does nothing at all
        with Session(engine) as session:
            set_setting(session, "backup_dir", "")
        assert main.backup_tick() is None, "an unconfigured schedule must stay off"
    finally:
        main.DB_PATH, main.UPLOAD_DIR, database_module.engine = original
        if engine is not None:
            engine.dispose()  # Windows: sqlite keeps the temp folder held open
        shutil.rmtree(tmp, ignore_errors=True)


def test_the_launcher_command_and_the_schedule_use_one_code_path_and_one_folder():
    """`python desktop.py --backup` runs in its own process - the other half of acceptance #9. It
    has to reach the same folder with the same dated files, because it calls the same
    run_configured() the schedule calls; this test catches it if the two ever drift apart."""
    tmp = Path(tempfile.mkdtemp(prefix="benchflow_launcher_backup_"))
    engine = None
    try:
        # the layout the app itself uses: uploads sits beside the data folder, not inside it
        db_path, engine = _own_engine(tmp / "data", "benchflow.db")
        _attachment(tmp / "uploads")
        backup = tmp / "backup"
        with Session(engine) as session:
            set_setting(session, "backup_dir", str(backup))
        engine.dispose()  # hand the file to the other process

        # Only this case's folders may reach the child: the vendored test_backup.py sets
        # BENCHFLOW_UPLOAD_DIR/BENCHFLOW_DATA_DIR in this process at import and never puts them
        # back, so a plain copy of os.environ sends the backup to a deleted temp folder.
        env = {k: v for k, v in os.environ.items() if not k.startswith("BENCHFLOW_")}
        env.update(BENCHFLOW_DATA_DIR=str(tmp / "data"), BENCHFLOW_APP_DATA=str(tmp),
                   BENCHFLOW_CONFIG_DIR=str(tmp))
        result = subprocess.run([sys.executable, str(ROOT / "backend" / "desktop.py"), "--backup"],
                                cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        # --backup has no console of its own: desktop.py tees what it prints into logs/ beside the
        # data folder, so that file - not stdout - is where a failure has to be read.
        for p in sorted((tmp / "logs").glob("*.log")):
            output += "\n" + p.read_text(encoding="utf-8", errors="replace")[-2000:]
        assert result.returncode == 0, output
        tree = "; ".join(str(q.relative_to(tmp)) for q in sorted(tmp.rglob("*")))
        assert list((backup / "history").glob("benchflow-*.db")), f"no dated snapshot: {output} | {tree}"
        assert (backup / "uploads" / "micrograph-01.png").is_file(), f"no attachment: {output} | {tree}"
    finally:
        if engine is not None:
            engine.dispose()
        shutil.rmtree(tmp, ignore_errors=True)


def test_the_schedule_keeps_going_after_a_failed_backup_and_stops_when_the_window_closes():
    """The timing half: it ticks on an interval, one failing tick does not kill the thread, and
    closing the window stops it."""
    calls: list = []

    def tick():
        calls.append(time.monotonic())
        if len(calls) == 1:
            raise RuntimeError("the OneDrive folder went away")
        return {"dest": "M:\\BenchflowBackup", "copied": 2}

    original_tick, original_interval = main.backup_tick, main.BACKUP_INTERVAL_SECONDS
    main.backup_tick, main.BACKUP_INTERVAL_SECONDS = tick, 0.05
    stop, thread = main.start_backup_scheduler()
    try:
        deadline = time.monotonic() + 3.0
        while len(calls) < 3 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert len(calls) >= 3, f"the schedule stopped after {len(calls)} tick(s)"
    finally:
        stop.set()
        thread.join(timeout=3.0)
        main.backup_tick, main.BACKUP_INTERVAL_SECONDS = original_tick, original_interval

    assert not thread.is_alive(), "the backup thread outlived the app"


if __name__ == "__main__":
    failed = []
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            try:
                _fn()
                print(f"ok  {_name}")
            except Exception:  # noqa: BLE001
                failed.append(_name)
                import traceback
                print(f"FAIL {_name}\n{traceback.format_exc()}")
    if failed:
        print("test_backup_schedule FAILED: " + ", ".join(failed))
        sys.exit(1)
    print("test_backup_schedule passed")
