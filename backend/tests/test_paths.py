"""Where the desktop build keeps its data - the one thing that must never be wrong.

Standalone:  python backend/tests/test_paths.py
Pytest:      pytest backend/tests

Every case runs in a fresh interpreter: app/paths.py reads its environment once, at import,
and app/database.py builds its engine from that result. A subprocess is also exactly how the
shipped app starts, so the test exercises the real thing instead of a re-imported imitation.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

PROBE = """
import json, sys
sys.path.insert(0, {backend!r})
if {frozen!r}:
    sys.frozen = True
    sys._MEIPASS = {frozen!r}
from app import paths
print(json.dumps({{
    "FROZEN": paths.FROZEN,
    "BASE_DIR": str(paths.BASE_DIR),
    "APP_DATA_DIR": str(paths.APP_DATA_DIR),
    "DATA_DIR": str(paths.DATA_DIR),
    "UPLOAD_DIR": str(paths.UPLOAD_DIR),
    "LOG_DIR": str(paths.LOG_DIR),
    "DB_PATH": str(paths.DB_PATH),
    "STATE_FILE": str(paths.STATE_FILE),
    "FRONTEND_DIST": str(paths.FRONTEND_DIST),
    "SEED_DIR": str(paths.SEED_DIR),
    "WEBVIEW_DATA_DIR": str(paths.WEBVIEW_DATA_DIR),
}}))
"""


def resolve(local_app_data: str | None = None, overrides: dict | None = None,
            frozen: str | None = None) -> dict:
    """Run app/paths.py in a fresh process with the given starting conditions."""
    env = dict(os.environ, PYTHONPATH=str(BACKEND))
    for key in ("BENCHFLOW_APP_DATA", "BENCHFLOW_DATA_DIR", "BENCHFLOW_UPLOAD_DIR",
                "BENCHFLOW_LOG_DIR", "BENCHFLOW_CONFIG_DIR"):
        env.pop(key, None)
    if local_app_data is None:
        env.pop("LOCALAPPDATA", None)
    else:
        env["LOCALAPPDATA"] = local_app_data
    env.update(overrides or {})
    code = PROBE.format(backend=str(BACKEND), frozen=frozen)
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                          env=env, timeout=60)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_data_folder_defaults_under_local_app_data():
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / "AppData" / "Local"
        p = resolve(str(local))
        assert p["APP_DATA_DIR"] == str(local / "Benchflow")
        assert p["DATA_DIR"] == str(local / "Benchflow" / "data")
        assert p["UPLOAD_DIR"] == str(local / "Benchflow" / "uploads")
        assert p["LOG_DIR"] == str(local / "Benchflow" / "logs")
        assert p["DB_PATH"] == str(local / "Benchflow" / "data" / "benchflow.db")
        assert p["STATE_FILE"] == str(local / "Benchflow" / "data" / "lab_state.json")
        assert p["WEBVIEW_DATA_DIR"] == str(local / "Benchflow" / "webview")


def test_data_dir_override_beats_the_default():
    """BENCHFLOW_DATA_DIR moves the notebook, and uploads/logs move with it (siblings of the
    data folder's parent). An explicit BENCHFLOW_UPLOAD_DIR still wins over that."""
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "notebook"
        p = resolve(str(Path(tmp) / "AppData"), {"BENCHFLOW_DATA_DIR": str(data)})
        assert p["DATA_DIR"] == str(data)
        assert p["DB_PATH"] == str(data / "benchflow.db")
        assert p["STATE_FILE"] == str(data / "lab_state.json")
        assert p["UPLOAD_DIR"] == str(Path(tmp) / "uploads")
        assert p["LOG_DIR"] == str(Path(tmp) / "logs")
        p = resolve(str(Path(tmp) / "AppData"), {"BENCHFLOW_DATA_DIR": str(data),
                                                 "BENCHFLOW_UPLOAD_DIR": str(Path(tmp) / "attachments")})
        assert p["UPLOAD_DIR"] == str(Path(tmp) / "attachments")
        assert p["LOG_DIR"] == str(Path(tmp) / "logs")


def test_writable_paths_never_land_in_program_files_or_the_install_folder():
    """The acceptance rule: %LOCALAPPDATA% wins over %PROGRAMFILES%, and with no
    %LOCALAPPDATA% at all the data still lands somewhere writable outside the code tree."""
    with tempfile.TemporaryDirectory() as tmp:
        install = Path(tmp) / "Program Files" / "Benchflow"
        install.mkdir(parents=True)
        env = {"PROGRAMFILES": str(install), "PROGRAMFILES(X86)": str(install),
               "ProgramFiles": str(install)}
        for label, local in (("no LOCALAPPDATA", None), ("LOCALAPPDATA set", str(Path(tmp) / "Local"))):
            for frozen in (None, str(install / "_internal")):
                p = resolve(local, env, frozen=frozen)
                writable = [p[k] for k in ("DATA_DIR", "UPLOAD_DIR", "LOG_DIR", "DB_PATH",
                                           "STATE_FILE", "WEBVIEW_DATA_DIR")]
                for path in writable:
                    assert "Program Files" not in path, (label, frozen, path)
                    assert not path.startswith(p["BASE_DIR"]), (label, frozen, path)
                assert p["DATA_DIR"] != str(install)


def test_frozen_build_reads_code_from_the_bundle_and_data_from_the_user_profile():
    """sys._MEIPASS is the read-only code tree (and the only place a bundle's own files are
    read from); the data folder stays in the user profile, so an in-place upgrade cannot
    touch a notebook."""
    with tempfile.TemporaryDirectory() as tmp:
        internal = Path(tmp) / "Program Files" / "Benchflow" / "_internal"
        local = Path(tmp) / "AppData" / "Local"
        p = resolve(str(local), frozen=str(internal))
        assert p["FROZEN"] is True
        assert p["BASE_DIR"] == str(internal)
        assert p["FRONTEND_DIST"] == str(internal / "frontend" / "dist")
        assert p["SEED_DIR"] == str(internal / "seed")
        assert p["DATA_DIR"] == str(local / "Benchflow" / "data")
        assert p["LOG_DIR"] == str(local / "Benchflow" / "logs")


def test_dev_build_keeps_code_in_the_repo_and_data_outside_it():
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / "AppData" / "Local"
        p = resolve(str(local))
        assert p["FROZEN"] is False
        assert p["BASE_DIR"] == str(BACKEND)
        assert p["FRONTEND_DIST"] == str(BACKEND.parent / "frontend" / "dist")
        assert p["SEED_DIR"] == str(BACKEND.parent / "seed")
        assert not str(p["DATA_DIR"]).startswith(str(BACKEND)), \
            "the notebook must not live in the tree the sync client watches"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("test_paths passed")
