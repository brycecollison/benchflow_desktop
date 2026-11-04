"""In-app updates: ask GitHub for the newest release, download its installer, run it.

Only an installed build offers an update. A dev checkout updates with git and the web app has no
installer, so `check()` answers "no" for both (see paths.FROZEN). Nothing here is needed to run
the app: every failure - no network, no release yet, GitHub hiccup - comes back as a string in
the Settings card, never as an exception at the window.

A release is usable when it is a GitHub release of this repository whose tag is newer than
`APP_VERSION` and that carries the installer `packaging/build.ps1` produces, named
`Benchflow-<version>-Setup.exe` (that name is how the asset is found, so it has to keep matching
`OutputBaseFilename` in packaging/setup.iss). A release with only source archives or only a zip
is reported as available but not installable.

The download goes to `<data folder>/updates/`, never the code tree and never the sync folder. It
is written as `.part` and renamed only once the byte count matches what the API said, so a
half-downloaded installer can never be the one that runs. The asset URL has to be GitHub over
https and the file name has to match the installer pattern - that is the whole trust boundary:
whatever GitHub says about its own release is believed, anything else is refused.

The installer is started detached and setup.iss runs with `CloseApplications=yes`, so Setup asks
to close this window. Closing through Setup is the clean way out: the window closes, the lifespan
shutdown publishes the notebook to the sync folder, and Setup replaces the files. A version check
does not compare schemas, so both computers should be updated together (see README).
"""

import json
import hashlib
import os
import re
import subprocess
import threading
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from app.paths import FROZEN, UPDATE_DIR
from app.sharepoint_export import APP_VERSION

RELEASES_API = "https://api.github.com/repos/brycecollison/benchflow_desktop/releases/latest"
USER_AGENT = f"Benchflow {APP_VERSION}"
TIMEOUT_SECONDS = 8.0
INSTALLER_NAME = re.compile(r"^Benchflow-[0-9][0-9.]*-Setup\.exe$", re.IGNORECASE)
_CHUNK = 1 << 16

# Progress for the UI, which polls GET /api/update while POST /api/update/download is in flight
# (uvicorn runs that endpoint in its threadpool, so the poll is served during the download).
DOWNLOAD: Dict[str, Any] = {"state": "idle"}
_CACHE: Dict[str, Any] = {}
_DOWNLOAD_LOCK = threading.Lock()


def parse_version(text: str) -> list:
    """Only stable numeric release tags are eligible for automatic updates."""
    match = re.fullmatch(r"[vV]?(\d+(?:\.\d+)*)", text or "")
    return [int(x) for x in match[1].split(".")] if match else [0]


def is_newer(candidate: str, current: str) -> bool:
    a, b = parse_version(candidate), parse_version(current)
    width = max(len(a), len(b))
    return (a + [0] * (width - len(a))) > (b + [0] * (width - len(b)))


def pick_asset(assets: list) -> Optional[Dict[str, Any]]:
    """The installer asset of a release, or None if the release has none."""
    for asset in assets:
        name = (asset.get("name") or "").strip()
        if INSTALLER_NAME.match(name):
            return asset
    return None


def _get_json(url: str):
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def latest_release() -> Dict[str, Any]:
    """The newest published release, as the UI needs it. Raises on any network/parse failure."""
    data = _get_json(RELEASES_API)
    tag = (data.get("tag_name") or "").strip()
    expected_name = f"Benchflow-{tag.lstrip('vV')}-Setup.exe"
    asset = pick_asset([a for a in (data.get("assets") or []) if a.get("name") == expected_name])
    return {
        "version": tag.lstrip("vV") or None,
        "tag": tag,
        "name": asset.get("name") if asset else None,
        "url": (asset.get("browser_download_url") or "") if asset else "",
        "size": asset.get("size") if asset else None,
        "digest": asset.get("digest") if asset else None,
        "notes": (data.get("body") or "").strip()[:4000] or None,
        "published_at": data.get("published_at"),
        "page": data.get("html_url"),
    }


def check(force: bool = False) -> Dict[str, Any]:
    """What the UI shows. GitHub is asked once per window open unless `force` (the Settings button)."""
    if not FROZEN:
        return {"current": APP_VERSION, "installed": False, "available": False, "installable": False,
                "reason": "not an installed build - this checkout updates with git",
                "download": DOWNLOAD}
    if force or not _CACHE:
        try:
            _CACHE["release"] = latest_release()
            _CACHE["error"] = None
        except Exception as e:  # noqa: BLE001 - offline laptop, no release yet, API hiccup
            _CACHE["release"] = None
            _CACHE["error"] = f"Could not check for updates: {e}"
        _CACHE["at"] = datetime.now(timezone.utc).isoformat()
    release = _CACHE.get("release")
    newer = bool(release and release["version"] and is_newer(release["version"], APP_VERSION))
    return {
        "current": APP_VERSION,
        "installed": True,
        "checked_at": _CACHE.get("at"),
        "error": _CACHE.get("error"),
        "latest": release,
        "available": newer,
        "installable": bool(newer and release.get("url")),
        "download": DOWNLOAD,
    }


def _release_to_install() -> Dict[str, Any]:
    if not FROZEN:
        raise RuntimeError("Updates can only be installed by an installed build")
    check()  # fills the cache if the UI opened Settings straight away
    release = _CACHE.get("release")
    if not release or not release.get("version"):
        raise RuntimeError("There is nothing to install - no release could be read")
    if not is_newer(release["version"], APP_VERSION):
        raise RuntimeError(f"Benchflow {APP_VERSION} is already the newest version")
    if not release.get("url"):
        raise RuntimeError(f"The {release['tag']} release has no Setup.exe to download")
    return release


def _asset_target(release: Dict[str, Any]) -> Path:
    """Validate the release's own URL and file name, then say where the file belongs."""
    from urllib.parse import urlsplit

    parts = urlsplit(release["url"])
    host = (parts.hostname or "").lower()
    if (parts.scheme != "https" or host != "github.com" or parts.username or parts.password
            or parts.port not in (None, 443)
            or not parts.path.startswith("/brycecollison/benchflow_desktop/releases/download/")):
        raise RuntimeError(f"Refusing to download from {parts.scheme or '?'}://{host or '?'}")
    name = (release.get("name") or "").strip()
    if not INSTALLER_NAME.match(name):
        raise RuntimeError(f"Unexpected installer name: {name or '(none)'}")
    return UPDATE_DIR / name


def _verified(path: Path, release: Dict[str, Any]) -> bool:
    if not path.is_file() or path.stat().st_size != release.get("size"):
        return False
    digest = release.get("digest")
    if digest:
        with path.open("rb") as stream:
            return digest == "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
    return True


def download(release: Dict[str, Any], opener=urllib.request.urlopen) -> Path:
    """Fetch the release's installer. `opener` is for tests; the default is urllib."""
    target = _asset_target(release)
    expected = release.get("size")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected <= 0:
        raise RuntimeError("The release has no valid installer size")
    target.parent.mkdir(parents=True, exist_ok=True)
    if _verified(target, release):
        DOWNLOAD.update({"state": "ready", "name": target.name, "path": str(target),
                         "got": target.stat().st_size, "total": expected, "detail": None})
        return target

    partial = target.with_name(target.name + ".part")
    DOWNLOAD.update({"state": "downloading", "name": target.name, "got": 0,
                     "total": expected, "detail": None})
    request = urllib.request.Request(release["url"], headers={"User-Agent": USER_AGENT})
    got = 0
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response, open(partial, "wb") as sink:
            while True:
                chunk = response.read(_CHUNK)
                if not chunk:
                    break
                sink.write(chunk)
                got += len(chunk)
                DOWNLOAD["got"] = got
        if expected and got != expected:
            raise RuntimeError(
                f"The download stopped at {got} of {expected} bytes - try again, or run "
                "Setup from the release page")
        if not _verified(partial, release):
            raise RuntimeError("Installer checksum does not match the GitHub release; try again")
        partial.replace(target)  # only a complete file gets the name the launcher will use
    except Exception as e:  # noqa: BLE001 - reported in the card, and the partial file is dropped
        DOWNLOAD.update({"state": "error", "detail": str(e)})
        try:
            partial.unlink()
        except OSError:
            pass
        raise
    DOWNLOAD.update({"state": "ready", "path": str(target), "detail": None})
    return target


def download_latest() -> Dict[str, Any]:
    if not _DOWNLOAD_LOCK.acquire(blocking=False):
        raise RuntimeError("An installer download is already in progress")
    try:
        download(_release_to_install())
        return DOWNLOAD
    except Exception as e:  # noqa: BLE001
        DOWNLOAD.update({"state": "error", "detail": str(e)})
        raise
    finally:
        _DOWNLOAD_LOCK.release()


def launch_installer() -> Dict[str, Any]:
    """Hand the downloaded installer to Windows and get out of the way.

    Detached on purpose: Setup outlives this process, and it is the one that closes the window
    (setup.iss `CloseApplications=yes`), which is also what publishes the notebook.
    """
    if DOWNLOAD.get("state") != "ready":
        raise RuntimeError("The installer has not finished downloading")
    path = Path(DOWNLOAD.get("path") or "")
    if not path.is_file():
        DOWNLOAD.update({"state": "error", "detail": f"{path} is gone"})
        raise RuntimeError(f"{path} is gone - download it again")
    release = _release_to_install()
    if path.resolve() != _asset_target(release).resolve() or not _verified(path, release):
        DOWNLOAD.update({"state": "error", "detail": "Installer changed or is for an older release; download again"})
        raise RuntimeError(DOWNLOAD["detail"])
    if os.name != "nt":
        raise RuntimeError("The installer is a Windows .exe; update this machine from its release page")
    DETACHED_PROCESS, CREATE_NEW_PROCESS_GROUP = 0x00000008, 0x00000200
    subprocess.Popen([str(path)], cwd=str(path.parent), close_fds=True,
                     creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
    DOWNLOAD.update({"state": "launched", "detail": None})
    return DOWNLOAD
