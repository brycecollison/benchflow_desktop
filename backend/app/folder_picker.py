"""Run the native folder dialog in its own process (Tk requires a main thread)."""

import json
import os
from pathlib import Path
import subprocess
import sys


def browse_folder(initial: str) -> str | None:
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), initial],
        capture_output=True, text=True, encoding="utf-8", check=True, timeout=300,
    )
    return json.loads(result.stdout)


def pick_folder(initial: str) -> str | None:
    import tkinter as tk
    from tkinter import filedialog

    start = Path(initial).expanduser() if initial.strip() else Path(os.environ.get("OneDrive", str(Path.home())))
    while not start.is_dir() and start != start.parent:
        start = start.parent
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        return filedialog.askdirectory(
            parent=root, title="Choose OneDrive backup folder", initialdir=str(start), mustexist=True,
        ) or None
    finally:
        root.destroy()


if __name__ == "__main__":
    print(json.dumps(pick_folder(sys.argv[1]), ensure_ascii=True))
