# -*- mode: python ; coding: utf-8 -*-
"""Smoke test for the frozen build: run the real Benchflow.exe and use it like a user.

Standalone:  venv\\Scripts\\python.exe packaging\\test_frozen.py
             (build first:  pyinstaller packaging/benchflow.spec)

This opens the real window on the real WebView2 runtime - that is the point. The PyInstaller
failure mode is a binary plugin that only breaks inside _MEIPASS, and it is invisible until a
TIFF preview is asked for. Everything the run writes goes into a throwaway BENCHFLOW_DATA_DIR,
so it never touches the notebook in %LOCALAPPDATA% or the seed folder it reads.

What it proves (implementation_plan.md Phase 2 + Phase 4 acceptance):
  the exe starts, /api/health answers, and GET / returns the built UI out of the bundle;
  a real .tif and .xlsx upload works, and the .tif gets a _preview.png next to it;
  a graceful close runs the closing backup (a new snapshot lands in history/);
  Benchflow.exe --mcp answers tools/list over stdio.

shortcut: no .nd2 exists in seed/uploads, so the ND2 row of the parity checklist (§8.1) is still
a manual step. Drop a real .nd2 into seed/uploads and it is picked up automatically.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE = Path(os.environ.get("BENCHFLOW_EXE") or (ROOT / "dist" / "Benchflow" / "Benchflow.exe"))
SEED_DB = ROOT / "seed" / "benchflow.db"
SAMPLE_DIRS = [ROOT / "seed" / "uploads", ROOT / "backend" / "tests" / "fixtures"]
START_TIMEOUT = 120  # a frozen first start unpacks nothing but imports a lot

IMAGE_EXTS = {".tif", ".tiff"}
DOCUMENT_EXTS = {".xlsx", ".csv"}
ND2_EXTS = {".nd2"}


def _sample(exts: set) -> Path | None:
    for folder in SAMPLE_DIRS:
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*")):
            if path.is_file() and path.suffix.lower() in exts and 0 < path.stat().st_size < 60_000_000:
                return path
    return None


def _env(tmp: Path) -> dict:
    """One throwaway data set for the run. BENCHFLOW_DATA_DIR moves the notebook, the uploads
    and the logs with it (app/paths.py), so a handful of keys is enough to isolate the run."""
    env = dict(os.environ)
    env["BENCHFLOW_DATA_DIR"] = str(tmp / "data")
    env["BENCHFLOW_APP_DATA"] = str(tmp / "appdata")       # instance lock + WebView2 profile
    env["BENCHFLOW_CONFIG_DIR"] = str(tmp / "config")
    (tmp / "data").mkdir(parents=True, exist_ok=True)
    # Pre-place the notebook so the first-run import dialog never appears: the test is about the
    # bundle, and an unanswered modal dialog would sit there until the timeout.
    shutil.copy2(SEED_DB, tmp / "data" / "benchflow.db")
    return env


def _request(port: int, method: str, path: str, body: bytes | None = None,
             content_type: str = "application/json") -> tuple[int, bytes]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{urllib.parse.quote(path, safe='/?=&%')}", data=body, method=method,
        headers={
            "Content-Type": content_type,
            # Phase 5 rejects mutating requests with a foreign or missing Origin, and the app's
            # own origin is exactly this. A test that omitted it would be testing the wrong thing.
            "Origin": f"http://127.0.0.1:{port}",
        })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def _upload(port: int, path: Path) -> dict:
    boundary = f"benchflow{uuid.uuid4().hex}"
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{path.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode()
    payload = head + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    status, raw = _request(port, "POST", "/api/lab/upload", payload,
                           content_type=f"multipart/form-data; boundary={boundary}")
    assert status == 200, f"upload of {path.name} failed: HTTP {status} {raw[:300]!r}"
    return json.loads(raw)


def _wait_for_port(app_data: Path, proc: subprocess.Popen) -> int:
    """desktop.py records "<port> <pid> <create time>" in desktop.lock once the server is up."""
    lock = app_data / "desktop.lock"
    deadline = time.monotonic() + START_TIMEOUT
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise AssertionError(f"Benchflow.exe exited with {proc.returncode} before serving. "
                                 f"See {lock.parent}")
        try:
            port = int(lock.read_text(encoding="utf-8").split()[0])
        except (OSError, ValueError, IndexError):
            time.sleep(0.5)
            continue
        for _ in range(60):
            try:
                status, _body = _request(port, "GET", "/api/health")
                if status == 200:
                    return port
            except OSError:
                pass
            time.sleep(0.5)
        break
    raise AssertionError(f"the app never answered /api/health within {START_TIMEOUT}s")


def _close_gracefully(proc: subprocess.Popen) -> None:
    """WM_CLOSE, the way a user closes it. taskkill /F would skip the shutdown backup."""
    subprocess.run(["taskkill", "/PID", str(proc.pid)], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise AssertionError("Benchflow.exe ignored WM_CLOSE for 60s")


def _newest_snapshot(history: Path) -> int:
    """mtime_ns of the newest snapshot in history/, or 0 when the folder is not there yet."""
    snaps = history.glob("benchflow-*.db") if history.is_dir() else []
    return max((f.stat().st_mtime_ns for f in snaps), default=0)


def test_frozen_build_end_to_end() -> None:
    if not SEED_DB.is_file():
        raise AssertionError(f"needs the seed notebook to test with: {SEED_DB}")

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as raw:
        tmp = Path(raw)
        env = _env(tmp)
        backup_dir = tmp / "backup"
        proc = subprocess.Popen([str(EXE)], env=env)
        try:
            port = _wait_for_port(tmp / "appdata", proc)

            # the built UI comes out of the bundle, not from disk next to the exe
            status, page = _request(port, "GET", "/")
            text = page.decode("utf-8", "replace")
            assert status == 200 and "<div id=\"root\">" in text, \
                f"GET / returned {status}, {len(text)} bytes - frontend/dist is not in the bundle"

            # scientific images: the binary-plugin failure mode (tifffile + imagecodecs)
            image = _sample(IMAGE_EXTS)
            assert image, f"no .tif to upload in {SAMPLE_DIRS}"
            result = _upload(port, image)
            assert result["preview_url"], f"no preview for {image.name}: {result}"
            preview_name = result["preview_url"].rsplit("/", 1)[-1]
            preview_file = tmp / "uploads" / preview_name
            assert preview_file.is_file(), f"{result['preview_url']} is not on disk at {preview_file}"
            status, _png = _request(port, "GET", result["preview_url"])
            assert status == 200, f"GET {result['preview_url']} -> {status}"

            # a spreadsheet the viewer can open
            sheet = _sample(DOCUMENT_EXTS)
            if sheet:
                uploaded = _upload(port, sheet)
                assert uploaded["size"] == sheet.stat().st_size, f"{sheet.name} arrived truncated"
            nd2 = _sample(ND2_EXTS)
            if nd2:
                result_nd2 = _upload(port, nd2)
                assert result_nd2["preview_url"], f"no preview for {nd2.name}: {result_nd2}"
            else:
                print(f"note: no .nd2 sample found under {SAMPLE_DIRS} - the ND2 row of the "
                      "parity checklist is unverified by this run")

            # closing backup: configure a folder (which backs up once now), then close the window
            status, raw_body = _request(port, "PUT", "/api/backup/config",
                                        json.dumps({"dir": str(backup_dir)}).encode())
            assert status == 200, f"PUT /api/backup/config -> {status}: {raw_body[:300]!r}"
            history = backup_dir / "history"
            # Compare the newest snapshot's mtime, not its name: history files are named to the
            # second, so a shutdown backup that lands in the same second as this one would rewrite
            # the same name and a name-set comparison would see no change.
            before = _newest_snapshot(history)
            assert before, f"configuring the backup folder wrote no snapshot into {history}"

            _close_gracefully(proc)

            assert _newest_snapshot(history) > before, \
                "closing the window ran no backup: no newer snapshot in history/ - " \
                "shutdown_backup() did not run, or the server was killed instead of closed"
            assert not (tmp / "appdata" / "desktop.lock").exists(), \
                "the instance lock file outlived the process; the next start would be refused"
        finally:
            if proc.poll() is None:
                proc.kill()


def test_frozen_build_serves_mcp_over_stdio() -> None:
    """Benchflow.exe --mcp must speak MCP on a pipe. The no-console build starts with
    sys.stdin/sys.stdout = None; desktop.py's reopen_stdio_pipes() is what fixes that, so this
    is the test for that function."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as raw:
        tmp = Path(raw)
        env = dict(os.environ)
        env["BENCHFLOW_DB_PATH"] = str(SEED_DB)      # the MCP server only ever reads
        env["BENCHFLOW_LOG_DIR"] = str(tmp / "logs")
        proc = subprocess.Popen([str(EXE), "--mcp"], env=env,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
        try:
            proc.stdin.write(json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05",
                           "capabilities": {},
                           "clientInfo": {"name": "frozen-smoke", "version": "0"}}}) + "\n")
            proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
            proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n")
            proc.stdin.flush()

            answers: list[dict] = []
            import threading

            def reader() -> None:
                for line in proc.stdout:
                    line = line.strip()
                    if line.startswith("{"):
                        answers.append(json.loads(line))
                    if any(a.get("id") == 2 for a in answers):
                        return

            thread = threading.Thread(target=reader, daemon=True)
            thread.start()
            thread.join(timeout=90)
            listing = next((a for a in answers if a.get("id") == 2), None)
            assert listing and "result" in listing, \
                f"--mcp produced no tools/list answer ({len(answers)} message(s)) - " \
                "stdio is broken in the frozen build"
            names = {t["name"] for t in listing["result"]["tools"]}
            assert "search_experiments" in names, f"tools/list looks wrong: {sorted(names)[:8]}"
        finally:
            proc.stdin.close()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()


def test_bundle_holds_no_cloud_sdk_and_no_writable_state() -> None:
    """Two ways a private notebook goes somewhere the researcher did not choose.

    A cloud SDK arriving through some dependency's optional import is the first one; the
    other is a build that writes its notebook or logs beside the exe, where a sync client
    watching the install folder would carry it off. Neither should be possible, so check the
    shipped tree rather than trust the import graph."""
    internal = EXE.parent / "_internal"
    cloud = ("boto3", "botocore", "aws", "azure", "msal", "google", "dropbox", "boxsdk")
    for path in internal.iterdir():
        assert not path.name.lower().startswith(cloud), f"{path.name} in the bundle - a cloud SDK"
    for name in ("benchflow.db", "lab_state.json", "data", "uploads", "logs", "webview"):
        assert not (EXE.parent / name).exists(), f"{name} beside the exe - the build writes into its install folder"


def _build_or_explain() -> None:
    if not EXE.is_file():
        raise SystemExit(
            f"No build at\n  {EXE}\n\nBuild it first:\n"
            "  npm --prefix frontend ci\n  npm --prefix frontend run build\n"
            "  venv\\Scripts\\pyinstaller.exe packaging\\benchflow.spec")


if __name__ == "__main__":
    _build_or_explain()
    failed = []
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"--- {name}")
            try:
                fn()
                print(f"ok  {name}")
            except Exception:  # noqa: BLE001
                import traceback

                failed.append(name)
                print(f"FAIL {name}\n{traceback.format_exc()}")
    if failed:
        print("test_frozen FAILED: " + ", ".join(failed))
        sys.exit(1)
    print("test_frozen passed")
