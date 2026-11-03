import os
import sys

import uvicorn


def _forward_import_arg() -> None:
    """Forward ``--import <dir>`` to the app as an env var.

    uvicorn (with reload) replaces sys.argv in the worker, so the CLI arg would be
    lost. Env vars survive the subprocess boundary, and app.main reads them first.
    """
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--import" and i + 1 < len(argv):
            os.environ["BENCHFLOW_IMPORT"] = argv[i + 1]
            return
        if a.startswith("--import="):
            os.environ["BENCHFLOW_IMPORT"] = a.split("=", 1)[1]
            return


if __name__ == "__main__":
    _forward_import_arg()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
