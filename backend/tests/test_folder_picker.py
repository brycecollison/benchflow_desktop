"""Run with: python tests/test_folder_picker.py (no dialog is opened)."""

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


if __name__ == "__main__":
    check_picker()
    check_endpoint()
    print("PASS: folder selection, cancellation, initial folder, cleanup, and API errors")
