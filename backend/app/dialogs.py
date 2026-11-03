"""Who answers "pick a folder" for this process.

The web app ran its folder dialog as a subprocess of its own interpreter
(`folder_picker.py` spawns `sys.executable`). That cannot work in the frozen build: there is
no interpreter to spawn, and `sys.executable` is Benchflow.exe itself. So the desktop shell
registers the native window dialog here when it starts, and the Settings browse endpoint
calls through this. Running `run.py` in a browser keeps the Tk subprocess, which works when a
terminal owns the process.
"""
from typing import Callable, Optional

_provider: Optional[Callable[[str], Optional[str]]] = None


def set_provider(provider: Optional[Callable[[str], Optional[str]]]) -> None:
    global _provider
    _provider = provider


def browse_folder(initial: str) -> Optional[str]:
    if _provider is not None:
        return _provider(initial)
    from app.folder_picker import browse_folder as tk_browse

    return tk_browse(initial)
