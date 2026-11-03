"""The folder picker, without ever opening a dialog.

Run with: python backend/tests/test_folder_picker.py

`test_picking_a_folder_writes_backup_dir` below drives the app's own endpoints, so it needs an
isolated notebook like every other test that touches the app: set BENCHFLOW_DATA_DIR (pytest does
it for you, see conftest.py) or it refuses to run rather than open the researcher's real file.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.folder_picker import browse_folder, pick_folder


def check_picker():
    with tempfile.TemporaryDirectory() as tmp:
        root = Mock()
        dialog = Mock(return_value=str(Path(tmp) / "Backup"))
        tkinter = SimpleNamespace(Tk=Mock(return_value=root), filedialog=SimpleNamespace(askdirectory=dialog))
        with patch.dict(sys.modules, {"tkinter": tkinter}):
            assert pick_folder(str(Path(tmp) / "not-created")) == str(Path(tmp) / "Backup")
            assert dialog.call_args.kwargs["initialdir"] == tmp
            assert dialog.call_args.kwargs["mustexist"] is True
            root.destroy.assert_called_once()
            dialog.return_value = ""
            assert pick_folder(tmp) is None
            dialog.side_effect = RuntimeError("No desktop")
            try:
                pick_folder(tmp)
                raise AssertionError("Expected dialog failure")
            except RuntimeError:
                pass
            assert root.destroy.call_count == 3

    selected = "C:/Users/José/OneDrive/Backup"
    with patch("app.folder_picker.subprocess.run", return_value=SimpleNamespace(stdout=json.dumps(selected))) as run:
        assert browse_folder(selected) == selected
        assert run.call_args.args[0][-1] == selected
        assert run.call_args.kwargs["timeout"] == 300
    with patch("app.folder_picker.subprocess.run", return_value=SimpleNamespace(stdout="null")):
        assert browse_folder("") is None


def check_endpoint():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["BENCHFLOW_DATA_DIR"] = str(Path(tmp) / "data")
        os.environ["BENCHFLOW_UPLOAD_DIR"] = str(Path(tmp) / "uploads")
        from fastapi import HTTPException
        from app.main import BackupConfigPayload, browse_backup_folder
        from app.database import engine

        req = BackupConfigPayload(dir="C:/OneDrive")
        for selection in ("C:/OneDrive/Backup", None):
            with patch("app.folder_picker.browse_folder", return_value=selection):
                assert browse_backup_folder(req) == {"dir": selection}
        for failure in (OSError("No Tk"), subprocess.TimeoutExpired("picker", 300)):
            with patch("app.folder_picker.browse_folder", side_effect=failure):
                try:
                    browse_backup_folder(req)
                    raise AssertionError("Expected HTTP error")
                except HTTPException as exc:
                    assert exc.status_code == 503
                    assert "manually" in exc.detail
        engine.dispose()


def test_picking_a_folder_writes_backup_dir():
    """The hard gate the plan asks for, and the bug class it aims at: Settings -> Browse has to
    end up writing the one row the schedule and the shutdown hook read (`backup_dir`), so the two
    can never point at different folders.

    The dialog is replaced by the provider the desktop shell registers (app/dialogs.py), so this
    runs with no Tk, no Windows API and no browser - but through the same two endpoint functions
    the Settings view calls: POST /api/backup/browse, then PUT /api/backup/config for Save.
    """
    if not os.environ.get("BENCHFLOW_DATA_DIR"):
        raise SystemExit(
            "refusing to run: BENCHFLOW_DATA_DIR is not set, and `import app.main` would seed the "
            "real notebook. Use pytest, or point it at a throwaway folder."
        )

    from sqlmodel import Session

    from app import dialogs
    from app.database import engine
    from app.db_service import get_setting
    from app.main import BackupConfigPayload, browse_backup_folder, put_backup_config

    with tempfile.TemporaryDirectory() as tmp:
        chosen = str(Path(tmp) / "OneDrive" / "BenchflowBackup")
        asked: list[str] = []

        def fake_dialog(initial: str) -> str:
            asked.append(initial)
            return chosen

        dialogs.set_provider(fake_dialog)
        try:
            with Session(engine) as session:
                picked = browse_backup_folder(BackupConfigPayload(dir=""))["dir"]
                assert picked == chosen, "Browse returned something other than the chosen folder"

                put_backup_config(BackupConfigPayload(dir=picked), session)
                saved = get_setting(session, "backup_dir")
                assert saved == chosen, (
                    f"Save wrote {saved!r}; the schedule reads backup_dir - they must be one setting"
                )
                assert (Path(chosen) / "benchflow.db").is_file(), "the saved folder got no snapshot"

                # Cancelling must leave the stored folder alone, and the dialog must re-open
                # where the setting says it is - that is what `initial` is for.
                dialogs.set_provider(lambda initial: (asked.append(initial), None)[1])
                assert browse_backup_folder(BackupConfigPayload(dir=saved))["dir"] is None
                assert get_setting(session, "backup_dir") == chosen
        finally:
            dialogs.set_provider(None)

        assert asked == ["", chosen], f"the dialog did not open at the saved folder: {asked}"


if __name__ == "__main__":
    check_picker()
    check_endpoint()
    test_picking_a_folder_writes_backup_dir()
    print("PASS: folder selection, cancellation, initial folder, cleanup, and API errors")
