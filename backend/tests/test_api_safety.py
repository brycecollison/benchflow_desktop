"""The one browser-facing guard: this app has no CSRF token, so writes from another site are
refused by Origin instead.

Run:  pytest backend/tests/test_api_safety.py
"""
import sys
from pathlib import Path

import pytest

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))


@pytest.fixture(scope="module")
def client():
    """The app under a throwaway data folder (conftest.py points it there).

    Imported here rather than at the top of the file: this file sorts before the vendored
    test_backup.py, which must be the first module in the process to import app.paths - it
    aims the app at its own temp folder and asserts that the aim took."""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _post(client, origin: str | None):
    headers = {"Origin": origin} if origin else {}
    return client.post("/api/lab/state", json={}, headers=headers)


@pytest.mark.parametrize(
    "origin",
    ["http://evil.example", "https://lab.example.com:8443", "http://127.0.0.1.evil.example"],
)
def test_write_from_another_site_is_refused(client, origin: str) -> None:
    response = _post(client, origin)
    assert response.status_code == 403, response.text
    assert "cross-origin" in response.json()["detail"]


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5173", "http://localhost:3000", None])
def test_write_from_our_own_page_or_a_script_goes_through(client, origin: str | None) -> None:
    response = _post(client, origin)
    assert response.status_code != 403, response.text
    # It still has to pass normal validation - the guard lets it in, it does not wave it through.
    assert response.status_code in (200, 422), response.text


def test_reading_from_another_site_is_allowed_but_writing_is_not(client) -> None:
    """Only writes are blocked; that is deliberate. Reading needs no CSRF defence - a cross-site
    fetch cannot be *read* by the attacker without CORS, and CORS is not offered (the web app's
    wildcard allow_origins=["*"] is gone)."""
    assert client.get("/api/health", headers={"Origin": "http://evil.example"}).status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in client.get("/api/health").headers}


def test_nothing_here_listens_beyond_this_machine() -> None:
    """The dev launcher is the only place this repo chooses a host; the desktop shell hardcodes
    127.0.0.1 in backend/desktop.py."""
    script = (_backend.parent / "start-dev.ps1").read_text(encoding="utf-8")
    assert "0.0.0.0" not in script, "the dev server must not listen on all interfaces"
