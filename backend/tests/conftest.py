"""pytest entry point for backend/tests.

It exists for one reason: `import app.main` creates tables and seeds state in whatever folder
app/paths.py points at, so the folder has to be redirected to a throwaway one before any test
module is imported. conftest.py is the only file guaranteed to run that early.

This covers `pytest` only. Run a test file directly (`venv/Scripts/python.exe
backend/tests/test_paths.py`) and you set the folder yourself - test_paths.py and
test_backup_schedule.py refuse to run rather than open the researcher's real notebook.

The vendored tests (test_backup.py, test_sharepoint_export.py, test_folder_picker.py) pass their
own paths and do not depend on this, but they are safer for it.
"""

import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

if not os.environ.get("BENCHFLOW_DATA_DIR"):
    tmp = Path(tempfile.mkdtemp(prefix="benchflow_tests_"))
    os.environ["BENCHFLOW_DATA_DIR"] = str(tmp / "data")
    os.environ.setdefault("BENCHFLOW_APP_DATA", str(tmp))
    os.environ.setdefault("BENCHFLOW_CONFIG_DIR", str(tmp))
    atexit.register(shutil.rmtree, tmp, True)  # Windows: sqlite may still hold the file
