"""Backend API smoke test.

Runs against a throwaway notebook in a temp folder: BENCHFLOW_DATA_DIR and BENCHFLOW_UPLOAD_DIR
are set before app.main is imported (see app/paths.py), because this test POSTs the whole lab
state and uploads a file - pointed at the real notebook it stamps updated_at on every project
and experiment and leaves uploaded files behind.

Run from backend/:  python test_api.py
"""

import os
import shutil
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="benchflow_api_"))
(TMP / "data").mkdir()
(TMP / "uploads").mkdir()
os.environ["BENCHFLOW_DATA_DIR"] = str(TMP / "data")
os.environ["BENCHFLOW_UPLOAD_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_backend(client):
    # 1. Health check
    res = client.get("/api/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    body = res.json()
    assert Path(body["db_path"]).is_relative_to(TMP), f"test is not isolated: {body['db_path']}"
    print("[PASS] Health check:", body["db_path"])

    # 2. Get state (the temp notebook was seeded by the app's startup)
    res = client.get("/api/lab/state")
    assert res.status_code == 200, f"Get state failed: {res.text}"
    state = res.json()
    assert "projects" in state and "papers" in state
    print(f"[PASS] State loaded: {len(state['projects'])} projects, {len(state['papers'])} papers")

    # 3. Post state
    res = client.post("/api/lab/state", json=state)
    assert res.status_code == 200, f"Update state failed: {res.text}"
    print("[PASS] State updated successfully")

    # 4. Upload file test
    file_content = b"Sample,Value\nA,10\nB,20"
    res = client.post(
        "/api/lab/upload",
        files={"file": ("test_data.csv", file_content, "text/csv")}
    )
    assert res.status_code == 200, f"Upload failed: {res.text}"
    upload_res = res.json()
    # "filename" is the original name; the stored file is the hash-prefixed one in the url.
    stored = TMP / "uploads" / upload_res["url"].rsplit("/", 1)[-1]
    assert stored.exists(), f"uploaded outside the temp folder: {upload_res['url']}"
    print("[PASS] File upload success:", stored.name)

    # 5. Granular experiment position PATCH test
    if state["projects"] and state["projects"][0]["exps"]:
        target_exp = state["projects"][0]["exps"][0]
        res = client.patch(
            f"/api/experiments/{target_exp['id']}/position",
            json={"px": 450.0, "py": 220.0}
        )
        assert res.status_code == 200, f"Position PATCH failed: {res.text}"
        patch_res = res.json()
        assert patch_res["px"] == 450.0 and patch_res["py"] == 220.0
        print(f"[PASS] Granular position update success: exp {target_exp['id']} -> ({patch_res['px']}, {patch_res['py']})")

    # 6. The OneDrive backup endpoint answers and refuses politely when unconfigured
    res = client.post("/api/backup")
    assert res.status_code == 400, f"unconfigured backup should be refused: {res.text}"
    print("[PASS] Backup endpoint refuses an unconfigured folder")


if __name__ == "__main__":
    try:
        # `with` runs the app's startup, which creates and seeds the temp database.
        with TestClient(app) as client:
            test_backend(client)
        print("\nALL BACKEND API TESTS PASSED!")
    finally:
        from app.database import engine

        engine.dispose()
        shutil.rmtree(TMP, ignore_errors=True)
