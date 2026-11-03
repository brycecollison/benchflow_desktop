# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Benchflow desktop app.

    pyinstaller packaging/benchflow.spec        # run from the repo root

**onedir, not onefile**: onefile re-extracts ~200 MB into %TEMP% on every launch (a cold start
that looks like a hang, a temp folder each run, and antivirus scanning it every time). onedir
starts straight from its install folder; Inno Setup packs the folder, and the folder zipped is
the portable fallback.

`console=False` because double-clicking must not leave a black window behind. The CLI modes get
their output back with AttachConsole (desktop.py: attach_console) and --mcp re-opens the pipes
the MCP client handed it (desktop.py: reopen_stdio_pipes).

The seed notebook is bundled so a clean machine can import it on first run (app/paths.py:
SEED_DIR). Drop it from `datas` to ship an empty app.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

ROOT = Path(SPECPATH).resolve().parent          # packaging/ -> repo root
BACKEND = ROOT / "backend"
FRONTEND_DIST = ROOT / "frontend" / "dist"
SEED = ROOT / "seed"
ICON = Path(SPECPATH) / "icon.ico"

if not (FRONTEND_DIST / "index.html").is_file():
    raise SystemExit("frontend/dist/index.html is missing - run: npm --prefix frontend run build")

# app/paths.py, frozen: FRONTEND_DIST = <bundle>/frontend/dist, SEED_DIR = <bundle>/seed.
datas = [(str(FRONTEND_DIST), "frontend/dist")]
if SEED.is_dir():
    datas.append((str(SEED), "seed"))

hiddenimports = [
    *collect_submodules("aspose.note"),   # the .one importer reaches its own submodules lazily
    *collect_submodules("imagecodecs"),   # the TIFF codecs are C extensions imported by name
    *collect_submodules("tifffile"),
    *collect_submodules("nd2"),
    *collect_submodules("webview"),       # pywebview picks the EdgeChromium backend at runtime
]
for _pkg in ("imagecodecs", "tifffile", "nd2", "aspose-note-foss"):
    datas += collect_data_files(_pkg)
    datas += copy_metadata(_pkg)          # some packages ask importlib.metadata at import

excludes = [
    "tkinter",                            # only the Linux folder-dialog fallback needs it
    "pip", "setuptools", "pytest", "_pytest", "iniconfig",
    "pythonwin", "pywin32_testall",       # pywin32 leftovers the app never loads
    "matplotlib", "PyQt5", "PyQt6", "PySide2", "PySide6", "gi",
]

a = Analysis(
    [str(BACKEND / "desktop.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

# pywin32's scripting add-ins come along with win32com and are never loaded here.
a.binaries = [b for b in a.binaries if "pywinscripting" not in Path(b[0]).name.lower()]
a.datas = [d for d in a.datas if "pywinscripting" not in Path(d[0]).name.lower()]

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Benchflow",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,                        # no console window on double-click
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_name=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ICON) if ICON.is_file() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Benchflow",
)
