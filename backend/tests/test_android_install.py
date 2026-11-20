"""Installing the phone app over USB (app/mobile_sync/android.py), against a fake adb."""
import io
import subprocess
import zipfile
from pathlib import Path

import pytest

from app.mobile_sync import android

DEVICES_READY = "List of devices attached\n57281FDCH001GV\tdevice product:blazer model:Pixel_10_Pro device:blazer transport_id:2\n\n"
DEVICES_UNAUTH = "List of devices attached\n57281FDCH001GV\tunauthorized transport_id:3\n\n"
DEVICES_NONE = "List of devices attached\n\n"


def test_parse_devices():
    assert android.parse_devices(DEVICES_READY) == [{"serial": "57281FDCH001GV", "state": "device", "model": "Pixel 10 Pro"}]
    assert android.parse_devices(DEVICES_UNAUTH)[0]["state"] == "unauthorized"
    assert android.parse_devices("* daemon not running; starting now\n* daemon started successfully\nList of devices attached\n\n") == []
    assert android.parse_devices(DEVICES_NONE) == []


@pytest.fixture
def fake(tmp_path, monkeypatch):
    """A phone plugged in, an APK on disk, and an adb whose answers the test sets."""
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"apk")
    state = {"devices": DEVICES_READY, "install": ("Performing Streamed Install\nSuccess\n", "", 0), "calls": []}

    def run(adb, *args, timeout=30):
        state["calls"].append(args)
        if args[:1] == ("devices",):
            return subprocess.CompletedProcess(args, 0, state["devices"], "")
        if "install" in args:
            out, err, code = state["install"]
            return subprocess.CompletedProcess(args, code, out, err)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(android, "find_apk", lambda: apk)
    monkeypatch.setattr(android, "find_adb", lambda: Path("adb"))
    monkeypatch.setattr(android, "_run", run)
    return state


def test_install_success_starts_the_app(fake):
    r = android.install()
    assert r["ok"] and r["code"] == "installed" and "Pixel 10 Pro" in r["message"]
    assert ("-s", "57281FDCH001GV", "install", "-r") == fake["calls"][1][:4]  # -r: keep the app's data
    assert any("am" in c and f"{android.PACKAGE}/.MainActivity" in c for c in fake["calls"])


@pytest.mark.parametrize("devices,code", [(DEVICES_NONE, "no_device"), (DEVICES_UNAUTH, "unauthorized")])
def test_install_needs_a_ready_phone(fake, devices, code):
    fake["devices"] = devices
    assert android.install()["code"] == code
    assert not any("install" in c for c in fake["calls"])


def test_install_refuses_to_guess_between_phones(fake):
    fake["devices"] = DEVICES_READY + "ABC123\tdevice model:Other\n"
    assert android.install()["code"] == "multiple"
    assert android.install("ABC123")["ok"]


@pytest.mark.parametrize("output,code", [
    ("adb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match]", "signature_mismatch"),
    ("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]", "downgrade"),
    ("adb: failed to install x.apk: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]", "failed"),
])
def test_install_failures_are_named(fake, output, code):
    fake["install"] = ("", output, 1)
    r = android.install()
    assert not r["ok"] and r["code"] == code
    if code == "failed":
        assert "INSUFFICIENT_STORAGE" in r["message"]


def test_install_without_apk_or_adb(fake, monkeypatch):
    monkeypatch.setattr(android, "find_adb", lambda: None)
    assert android.install()["code"] == "no_adb"
    monkeypatch.setattr(android, "find_apk", lambda: None)
    assert android.install()["code"] == "no_apk"


def test_status(fake):
    s = android.status()
    assert s["apk"] == {"size": 3} and s["adb"] is True and s["devices"][0]["state"] == "device"


def test_find_adb_prefers_our_download(tmp_path, monkeypatch):
    for root in (tmp_path / "ours", tmp_path / "sdk" / "platform-tools"):
        root.mkdir(parents=True)
        (root / android._ADB).write_bytes(b"")
    monkeypatch.setattr(android, "ADB_DIR", tmp_path / "ours")
    monkeypatch.setenv("ANDROID_HOME", str(tmp_path / "sdk"))
    assert android.find_adb() == tmp_path / "ours" / android._ADB
    monkeypatch.setattr(android, "ADB_DIR", tmp_path / "missing")
    assert android.find_adb() == tmp_path / "sdk" / "platform-tools" / android._ADB


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def test_download_adb_unpacks_platform_tools(tmp_path, monkeypatch):
    monkeypatch.setattr(android, "ADB_DIR", tmp_path / "platform-tools")
    monkeypatch.setattr(android.urllib.request, "urlopen", lambda url, timeout: _Resp(_zip({f"platform-tools/{android._ADB}": b"exe"})))
    assert android.download_adb().read_bytes() == b"exe"


def test_download_adb_rejects_a_bad_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(android, "ADB_DIR", tmp_path / "platform-tools")
    monkeypatch.setattr(android.urllib.request, "urlopen", lambda url, timeout: _Resp(b"not a zip"))
    with pytest.raises(RuntimeError):
        android.download_adb()
    monkeypatch.setattr(android.urllib.request, "urlopen", lambda url, timeout: _Resp(_zip({"platform-tools/readme.txt": b"x"})))
    with pytest.raises(RuntimeError, match="adb"):
        android.download_adb()
    assert not (tmp_path / "platform-tools").exists()


def test_window_endpoints(fake):
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app, base_url="http://localhost")
    assert c.get("/api/mobile/android").json()["adb"] is True
    r = c.post("/api/mobile/android/install", json={})
    assert r.status_code == 200 and r.json()["ok"] is True
    calls = len(fake["calls"])  # a web page on another site must not be able to start an install
    assert c.post("/api/mobile/android/install", json={}, headers={"Origin": "http://evil.example"}).status_code == 403
    assert len(fake["calls"]) == calls
