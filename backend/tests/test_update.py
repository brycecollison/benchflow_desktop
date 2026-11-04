"""Self-checks for the in-app update check, download and install hand-off.

Runs either way:
    pytest backend/tests/test_update.py
    python tests/test_update.py          (from backend/)

What matters here is what must *not* happen: a half-downloaded installer must never become the
file that runs, a URL that is not GitHub must never be fetched, and a dev checkout must never be
told to install a Windows setup program. GitHub itself is stubbed - no test reaches the network.

BENCHFLOW_DATA_DIR/BENCHFLOW_UPLOAD_DIR are pointed at a temp folder before app.main is imported,
so the real notebook is never opened.
"""

import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TMP = Path(tempfile.mkdtemp(prefix="benchflow_update_"))
os.environ["BENCHFLOW_DATA_DIR"] = str(TMP / "data")
os.environ["BENCHFLOW_UPLOAD_DIR"] = str(TMP / "uploads")

import app.update as updater  # noqa: E402  (sees the env above via app.paths)
import pytest  # noqa: E402

RELEASE = {
    "tag_name": "v1.9.0",
    "body": "## Added\n- something new",
    "html_url": "https://github.com/brycecollison/benchflow_desktop/releases/tag/v1.9.0",
    "published_at": "2026-01-01T00:00:00Z",
    "assets": [
        {"name": "source.zip", "browser_download_url": "https://github.com/x/y/archive.zip", "size": 10},
        {"name": "Benchflow-1.9.0-Setup.exe", "size": 255,
         "browser_download_url": "https://github.com/brycecollison/benchflow_desktop/releases/"
                                 "download/v1.9.0/Benchflow-1.9.0-Setup.exe"},
    ],
}
NO_ASSETS = {**RELEASE, "assets": []}

_PATCHED = ("_get_json", "FROZEN", "UPDATE_DIR", "_CACHE", "DOWNLOAD")
_ORIGINALS = {k: getattr(updater, k) for k in _PATCHED}


def _restore() -> None:
    for key, value in _ORIGINALS.items():
        setattr(updater, key, value)


@pytest.fixture(autouse=True)
def _restore_after_each_test():
    """These tests patch module globals of app.update; under pytest that would otherwise leak into
    whatever test module runs next (and app.main hands the update module to every request)."""
    yield
    _restore()


def _stub_github(payload=None, boom=None):
    """A stand-in for the GitHub API, and a fresh cache so the stub is what gets read."""
    def fake_get_json(url):
        assert url == updater.RELEASES_API
        if boom:
            raise boom
        return payload if payload is not None else RELEASE
    updater._get_json = fake_get_json
    updater._CACHE = {}


def _release(**over):
    """The shape check() puts under "latest", which is what download() takes."""
    asset = updater.pick_asset(RELEASE["assets"])
    base = {"version": "1.9.0", "tag": "v1.9.0", "name": asset["name"],
            "url": asset["browser_download_url"], "size": asset["size"]}
    return {**base, **over}


def _opener(payload: bytes):
    return lambda request, timeout: io.BytesIO(payload)


def _client():
    """The app under the throwaway data folder this file pointed at. Built on first use so
    app.paths is aimed at that env before app.main is loaded."""
    if not hasattr(_client, "instance"):
        from fastapi.testclient import TestClient

        from app.main import app

        _client.instance = TestClient(app)
    return _client.instance


def test_version_compare():
    assert updater.is_newer("v1.4.0", "1.3.0")
    assert updater.is_newer("v1.4", "1.3.9")              # tag with fewer parts, same shape
    assert not updater.is_newer("v1.3.0", "1.3.0")
    assert not updater.is_newer("v1.2", "1.3.0")
    assert updater.is_newer("1.10.0", "1.9.0")            # numeric, not lexicographic
    assert not updater.is_newer("", "1.3.0")              # a release with no tag is not an update


def test_prerelease_tags_are_not_stable_updates():
    assert not updater.is_newer("v1.3.0-rc1", "1.3.0")
    assert not updater.is_newer("v9.0.0-beta", "1.0.0")


def test_download_verifies_checksum_even_for_same_size_cached_file():
    import hashlib
    updater.UPDATE_DIR = TMP / "checksum-updates"
    updater.UPDATE_DIR.mkdir(exist_ok=True)
    release = _release(size=3, digest="sha256:" + hashlib.sha256(b"abc").hexdigest())
    target = updater.UPDATE_DIR / release["name"]
    target.write_bytes(b"bad")
    with pytest.raises(RuntimeError, match="checksum"):
        updater.download(release, opener=_opener(b"bad"))
    assert updater.DOWNLOAD["state"] == "error"
    assert updater.download(release, opener=_opener(b"abc")).read_bytes() == b"abc"


def test_download_requires_size_and_times_out():
    updater.UPDATE_DIR = TMP / "timeout-updates"
    with pytest.raises(RuntimeError, match="valid installer size"):
        updater.download(_release(size=None), opener=_opener(b""))
    def offline(request, timeout):
        assert timeout == updater.TIMEOUT_SECONDS
        raise TimeoutError("timed out")
    with pytest.raises(TimeoutError):
        updater.download(_release(), opener=offline)
    assert updater.DOWNLOAD["state"] == "error"
    assert not list(updater.UPDATE_DIR.glob("*.part"))


def test_parallel_download_is_refused_without_changing_progress():
    updater.DOWNLOAD = {"state": "downloading", "got": 42}
    with updater._DOWNLOAD_LOCK:
        with pytest.raises(RuntimeError, match="already in progress"):
            updater.download_latest()
    assert updater.DOWNLOAD == {"state": "downloading", "got": 42}


def test_checkout_cannot_download_even_with_a_cached_release():
    updater.FROZEN = False
    updater._CACHE = {"release": _release()}
    with pytest.raises(RuntimeError, match="installed build"):
        updater.download_latest()


def test_installer_asset_is_the_one_that_gets_used():
    assert updater.pick_asset(RELEASE["assets"])["name"] == "Benchflow-1.9.0-Setup.exe"
    assert updater.pick_asset([{"name": "Benchflow-1.9.0.zip", "browser_download_url": "x"}]) is None
    assert updater.pick_asset([{"name": "Setup.exe", "browser_download_url": "x"}]) is None


def test_dev_checkout_is_never_told_to_install():
    updater.FROZEN = False
    result = updater.check(force=True)
    assert not result["installed"], "a checkout has no installer to replace, so the UI shows nothing"
    assert not result["available"] and not result["installable"]
    assert "git" in result["reason"]


def test_check_reports_an_available_installable_build():
    _stub_github()
    updater.FROZEN = True
    result = updater.check(force=True)
    assert result["installed"] and result["available"] and result["installable"]
    assert result["latest"]["name"] == "Benchflow-1.9.0-Setup.exe"
    assert "something new" in result["latest"]["notes"]

    _stub_github(payload=NO_ASSETS)                      # announced, but nothing to fetch
    result = updater.check(force=True)
    assert result["available"] and not result["installable"]


def test_check_asks_github_once_per_window():
    calls = []

    def counting(url):
        calls.append(url)
        return RELEASE

    updater._get_json = counting
    updater._CACHE = {}
    updater.FROZEN = True
    updater.check(force=True)
    for _ in range(3):                                   # the UI polls this while it downloads
        updater.check()
    assert len(calls) == 1, "the poll loop is hammering the GitHub API"


def test_check_survives_no_network():
    _stub_github(boom=OSError("getaddrinfo failed"))
    updater.FROZEN = True
    result = updater.check(force=True)
    assert not result["available"] and "getaddrinfo" in result["error"]


def test_download_writes_only_a_complete_file():
    updates = TMP / "updates"
    updater.UPDATE_DIR = updates

    with pytest.raises(RuntimeError, match="stopped at 3 of 255"):
        updater.download(_release(size=255), opener=_opener(b"abc"))
    assert not (updates / _release()["name"]).exists(), "a partial installer got the real name"
    assert not list(updates.glob("*.part")), "a partial installer was left behind"
    assert updater.DOWNLOAD["state"] == "error"

    path = updater.download(_release(), opener=_opener(b"\x00" * 255))
    assert path.name == _release()["name"] and path.stat().st_size == 255
    assert updater.DOWNLOAD["state"] == "ready"

    def no_more_requests(request, timeout):
        raise AssertionError("the installer was downloaded twice")
    assert updater.download(_release(), opener=no_more_requests) == path


def test_download_refuses_anything_that_is_not_github():
    updater.UPDATE_DIR = TMP / "updates"
    for url in (
        "http://github.com/a/Benchflow-1.9.0-Setup.exe",              # plain http
        "https://evil.com/Benchflow-1.9.0-Setup.exe",                 # wrong host
        "https://github.com/other/repo/releases/download/v1/Benchflow-1-Setup.exe",
        "https://github.com.evil.com/a/Benchflow-1.9.0-Setup.exe",    # host-suffix trick
    ):
        with pytest.raises(RuntimeError, match="Refusing"):
            updater.download(_release(url=url), opener=_opener(b"x"))
    for name in ("Benchflow-1.9.0.zip", "anything.exe"):
        with pytest.raises(RuntimeError, match="Unexpected installer"):
            updater.download(_release(name=name), opener=_opener(b"x"))


def test_download_latest_refuses_a_release_with_no_installer():
    _stub_github(payload=NO_ASSETS)
    updater.FROZEN = True
    updater.UPDATE_DIR = TMP / "updates"
    with pytest.raises(RuntimeError, match="no Setup.exe"):
        updater.download_latest()
    assert updater.DOWNLOAD["state"] == "error"


def test_install_needs_a_finished_download():
    updater.DOWNLOAD = {"state": "downloading"}
    with pytest.raises(RuntimeError, match="not finished"):
        updater.launch_installer()
    updater.DOWNLOAD = {"state": "ready", "path": str(TMP / "gone.exe")}
    with pytest.raises(RuntimeError, match="gone"):
        updater.launch_installer()


def test_update_endpoints_describe_their_own_state():
    client = _client()
    updater.FROZEN, updater._CACHE = False, {}
    body = client.get("/api/update").json()
    assert not body["installed"] and not body["available"]              # this run is a checkout

    _stub_github()
    updater.FROZEN = True
    body = client.get("/api/update", params={"force": True}).json()
    assert body["available"] and body["installable"]

    blocked = client.post("/api/update/install", headers={"Origin": "http://evil.example"})
    assert blocked.status_code == 403                                  # the write guard applies
    assert client.post("/api/update/install").status_code == 400       # nothing downloaded yet


def _run() -> None:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        _restore()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(fns)} tests passed")


if __name__ == "__main__":
    _run()
    shutil.rmtree(TMP, ignore_errors=True)
