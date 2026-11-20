"""Install the Benchflow phone app on an Android phone plugged in over USB.

One implementation for every caller: the Settings > Phone sync card (app/main.py), the
`Benchflow.exe --install-android` mode, and install-android.ps1 (`python -m app.mobile_sync.android`).

The APK is the debug-signed build from mobile/build-apk.ps1, bundled into the exe by
packaging/benchflow.spec. `adb` is not bundled (Google's SDK terms); it is found on this PC or
downloaded once from Google into the app's data folder.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.paths import APP_DATA_DIR, BASE_DIR, FROZEN

PACKAGE = "org.benchflow.companion"
APK_NAME = "benchflow-companion.apk"
PLATFORM_TOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
ADB_DIR = APP_DATA_DIR / "platform-tools"
_ADB = "adb.exe" if sys.platform == "win32" else "adb"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0

_REPO = BASE_DIR.parent
_GRADLE_APK = _REPO / "mobile" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"


def find_apk() -> Optional[Path]:
    """The bundled APK (frozen), else the one mobile/build-apk.ps1 left in a dev checkout."""
    candidates = [BASE_DIR / "android" / APK_NAME] if FROZEN else [_REPO / "build" / "android" / APK_NAME, _GRADLE_APK]
    return next((p for p in candidates if p.is_file() and p.stat().st_size > 0), None)


def find_adb() -> Optional[Path]:
    """adb from our own download, the Android SDK, or PATH."""
    roots = [ADB_DIR, *(Path(os.environ[k]) / "platform-tools" for k in ("ANDROID_HOME", "ANDROID_SDK_ROOT") if os.environ.get(k)),
             Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk" / "platform-tools"]
    found = next((r / _ADB for r in roots if (r / _ADB).is_file()), None)
    return found or (Path(p) if (p := shutil.which("adb")) else None)


def download_adb() -> Path:
    """Android platform-tools from Google (about 7 MB, HTTPS), unpacked into ADB_DIR."""
    ADB_DIR.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ADB_DIR.parent) as tmp:
        archive = Path(tmp) / "platform-tools.zip"
        try:
            with urllib.request.urlopen(PLATFORM_TOOLS_URL, timeout=60) as resp, archive.open("wb") as out:
                shutil.copyfileobj(resp, out)
            with zipfile.ZipFile(archive) as z:  # extractall refuses paths that climb out of the folder
                z.extractall(tmp)
        except (OSError, zipfile.BadZipFile) as error:
            raise RuntimeError(f"Could not download the Android tools from Google: {error}") from error
        unpacked = Path(tmp) / "platform-tools"
        if not (unpacked / _ADB).is_file():
            raise RuntimeError("The Android tools download did not contain adb")
        shutil.rmtree(ADB_DIR, ignore_errors=True)
        shutil.move(str(unpacked), str(ADB_DIR))
    return ADB_DIR / _ADB


def _run(adb: Path, *args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run([str(adb), *args], capture_output=True, text=True, timeout=timeout, creationflags=_NO_WINDOW)


def parse_devices(text: str) -> List[Dict[str, str]]:
    """`adb devices -l` -> [{serial, state, model}]. state: device (ready), unauthorized, offline."""
    out = []
    lines = text.splitlines()
    # a first run prints "* daemon started successfully" before the header
    start = next((i + 1 for i, line in enumerate(lines) if line.startswith("List of devices")), len(lines))
    for line in lines[start:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        model = next((p[6:] for p in parts[2:] if p.startswith("model:")), "")
        out.append({"serial": parts[0], "state": parts[1], "model": model.replace("_", " ")})
    return out


def list_devices(adb: Path) -> List[Dict[str, str]]:
    try:
        return parse_devices(_run(adb, "devices", "-l", timeout=30).stdout)
    except (OSError, subprocess.TimeoutExpired):
        return []


def status() -> Dict[str, Any]:
    apk, adb = find_apk(), find_adb()
    return {"apk": {"size": apk.stat().st_size} if apk else None, "adb": bool(adb),
            "devices": list_devices(adb) if adb else []}


def _result(ok: bool, code: str, message: str) -> Dict[str, Any]:
    return {"ok": ok, "code": code, "message": message}


def install(serial: str = "") -> Dict[str, Any]:
    """`adb install -r` the bundled APK on the one ready phone (or `serial`). -r keeps the app's
    data, so updating never loses unsynced edits."""
    apk, adb = find_apk(), find_adb()
    if not apk:
        return _result(False, "no_apk", "This build of Benchflow does not include the phone app. "
                       "Build it with mobile\\build-apk.ps1 (see the README), or install a release that does.")
    if not adb:
        return _result(False, "no_adb", "The Android tools (adb) are not installed on this computer.")
    devices = list_devices(adb)
    ready = [d for d in devices if d["state"] == "device"]
    if serial:
        ready = [d for d in ready if d["serial"] == serial]
    if not ready:
        if any(d["state"] == "unauthorized" for d in devices):
            return _result(False, "unauthorized", "Look at the phone's screen and tap Allow on the "
                           "'Allow USB debugging?' prompt (tick 'Always allow'), then try again.")
        return _result(False, "no_device", "No phone found. Plug it in with a USB cable that carries data, "
                       "turn on USB debugging (Settings > Developer options), and unlock the phone.")
    if len(ready) > 1:
        return _result(False, "multiple", "More than one phone is connected. Unplug all but one.")
    target = ready[0]["serial"]
    try:
        done = _run(adb, "-s", target, "install", "-r", str(apk), timeout=240)
    except (OSError, subprocess.TimeoutExpired) as error:
        return _result(False, "failed", f"adb did not finish: {error}")
    output = (done.stdout + done.stderr).strip()
    if done.returncode == 0 and "Success" in output:
        try:  # best effort: bring the app up so the next step (pairing) is on screen
            _run(adb, "-s", target, "shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity", timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass
        return _result(True, "installed", f"Installed on {ready[0]['model'] or target}. Open Benchflow Companion on the phone to pair it.")
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in output or "signatures do not match" in output:
        return _result(False, "signature_mismatch", "The phone has a copy of the app signed by a different build, so it "
                       "cannot be updated in place. Sync it first, then uninstall Benchflow Companion on the phone "
                       "(anything not yet synced is lost) and install again.")
    if "INSTALL_FAILED_VERSION_DOWNGRADE" in output:
        return _result(False, "downgrade", "The phone already has a newer version of the app.")
    last = re.sub(r"\s+", " ", output.splitlines()[-1]) if output else f"exit code {done.returncode}"
    return _result(False, "failed", f"The install failed: {last}")


def cli(argv: Optional[List[str]] = None) -> int:
    """`--install-android` / `python -m app.mobile_sync.android [--serial S] [--status]`."""
    args = list(sys.argv[1:] if argv is None else argv)
    serial = args[args.index("--serial") + 1] if "--serial" in args and args.index("--serial") + 1 < len(args) else ""
    if "--status" in args:
        print(json.dumps(status(), indent=2))
        return 0
    if find_apk() and not find_adb():
        print("adb (Android tools) not found; downloading them from Google (about 7 MB)...")
        try:
            download_adb()
        except RuntimeError as error:
            print(error)
            return 1
    result = install(serial)
    print(result["message"])
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(cli())
