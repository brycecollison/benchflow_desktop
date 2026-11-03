"""Verify the first-run import: copy (never move), reference-preserving, source rejection."""
import os
import sys
import tempfile
import hashlib
from pathlib import Path

REPO = Path("C:/Users/bryce/Desktop/Repos/Benchflow_desktop")
tmp = Path(tempfile.mkdtemp(prefix="benchflow-import-test-"))
data_dir = tmp / "data"
upload_dir = tmp / "uploads"

# Point the app at an EMPTY data dir (simulates a fresh frozen profile) before import.
os.environ["BENCHFLOW_DATA_DIR"] = str(data_dir)
os.environ["BENCHFLOW_UPLOAD_DIR"] = str(upload_dir)
sys.path.insert(0, str(REPO / "backend"))

from app.desktop_import import ensure_data_seeded, _valid_source, code_tree  # noqa: E402

seed = REPO / "seed"

# checksum one large upload in the source BEFORE import (to prove the source is untouched)
big = max((f for f in (seed / "uploads").iterdir() if f.is_file()), key=lambda f: f.stat().st_size)
def _md5(p):
    return hashlib.md5(Path(p).read_bytes()).hexdigest()
src_big_before = _md5(big)
src_count_before = len([f for f in (seed / "uploads").iterdir() if f.is_file()])

# --- Test 1: --import path seeds an empty data dir ---
assert not (data_dir / "benchflow.db").exists(), "precondition: data dir must be empty"
ensure_data_seeded(cli_import=str(seed))

db = data_dir / "benchflow.db"
assert db.is_file(), "FAIL: benchflow.db not copied"
copied = [f for f in upload_dir.iterdir() if f.is_file()]
assert len(copied) == src_count_before, f"FAIL: expected {src_count_before} uploads, got {len(copied)}"
# reference-preserving: the big file kept its original name and content
assert (upload_dir / big.name).is_file(), "FAIL: upload did not keep its original name"
assert _md5(upload_dir / big.name) == src_big_before, "FAIL: copied upload content differs from source"
print(f"PASS 1: --import copied db + {len(copied)} uploads with original names (content-identical)")

# --- Test 2: source is never modified (copy, not move) ---
assert _md5(big) == src_big_before, "FAIL: source file was modified"
assert len([f for f in (seed / "uploads").iterdir() if f.is_file()]) == src_count_before, "FAIL: source uploads changed"
print("PASS 2: source folder untouched (copy, never move)")

# --- Test 3: a source inside the code tree is rejected (but the bundled seed is exempt) ---
tree = code_tree()
inner = REPO / "backend"
assert not _valid_source(inner, tree, seed), "FAIL: code-tree source should be invalid"
inner_db = REPO / "backend" / "data" / "benchflow.db"
if inner_db.is_file():
    assert not _valid_source(inner_db.parent, tree, seed), "FAIL: backend/data (in code tree) should be rejected"
assert _valid_source(seed, tree, seed), "FAIL: the bundled seed must always be valid"
print("PASS 3: code-tree sources rejected; bundled seed exempt")

# --- Test 4: idempotent - a second run is a no-op (db now exists) ---
import app.paths as P
assert P.DB_PATH.exists()
ensure_data_seeded(cli_import=str(seed))  # should return immediately
print("PASS 4: no-op once the db exists")

print("\nALL FIRST-RUN IMPORT TESTS PASSED")
