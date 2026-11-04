"""Export the local Benchflow notebook into a SharePoint-synced folder.

The lab's BENCHFLOW folder lives in the SharePoint site and is synced by the
SharePoint desktop sync client, so this module only writes local files — no
API auth, no Azure app registration. The sync client does the uploading.

Layout written under <dest>/<member>/ :
    manifest.json              schema_version, export ts, papers, attachment map
    projects/<project_id>.json one file per project (LabState Project shape)
    attachments/<sync_name>    copies of the referenced uploads/ files

Only files actually referenced by notebook content are exported (union of the
section markdown, blocks, custom phases, phase list, and lab_state.json) —
orphans and derived junk stay behind. Files at/above SIZE_LIMIT are never
written into the synced folder (the sync client parks them in permanent
"file too large" error state); they are recorded in the manifest as
metadata-only entries instead.

Run on demand:
    python -m app.sharepoint_export --dest C:\\OneDrive\\BENCHFLOW --member bryce

Or automatically on app shutdown when BENCHFLOW_SHAREPOINT_DIR is set
(see the lifespan hook in main.py).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

from sqlmodel import Session, create_engine, select

from app.db_service import get_lab_state
from app.models import ExperimentDB

SCHEMA_VERSION = 1
# App version recorded in the manifest; keep in sync with the FastAPI title version.
APP_VERSION = "1.0.1"
# Headroom below SharePoint's hard 250 MB per-file sync limit.
SIZE_LIMIT = 200 * 1024 * 1024
# SharePoint file names: max 50 chars (extension separate, max 7). Keep margin.
MAX_STEM = 45
MAX_EXT = 6
# Characters SharePoint file names may not contain: : * ? " < > \ | /
_FORBIDDEN = re.compile(r'[:*?"<>\\|/]')

# Quoted /uploads/NAME refs in raw JSON/HTML text. The trailing-backslash
# artifact from escaped quotes (\"/uploads/x.tif\") is stripped in _clean.
_QT = re.compile(r'["\']/uploads/([^"\'\n]+)["\']')


def _clean(s: str) -> str:
    return s.rstrip("\\").strip()


def md_refs(text: str) -> List[str]:
    """Extract /uploads/ names from markdown links, paren-depth aware.

    Handles internal spaces, balanced parens in file names (e.g.
    drugs(Coomassie Blue).tif), and the optional "title" suffix after the
    destination. A naive [^)]+ regex truncates at the first internal ')'.
    """
    out: List[str] = []
    i = 0
    while True:
        j = text.find("](", i)
        if j < 0:
            break
        start = j + 2
        if not text.startswith("/uploads/", start):
            i = j + 2
            continue
        k, depth, n = start + 9, 0, len(text)
        while k < n:
            c = text[k]
            if c == "(":
                depth += 1
            elif c == ")":
                if depth == 0:
                    break
                depth -= 1
            elif c == '"' and depth == 0:
                break  # start of a "title" suffix
            elif c in "]\n":
                break
            k += 1
        name = _clean(text[start + 9 : k])
        if name:
            out.append(name)
        i = k + 1
    return out


def refs_from_text(text: Optional[str]) -> Set[str]:
    """All /uploads/ attachment names referenced in one text blob."""
    if not text:
        return set()
    refs = set(md_refs(text))
    refs.update(_clean(m[1]) for m in _QT.finditer(text))
    return refs


_SCAN_COLS = (
    "purpose", "expected_results", "experimental_design", "experimental_protocol",
    "data_acquisition", "data_analysis", "results", "notes",
    "blocks", "custom_phases", "phases",
)


def extract_refs(session: Session, state_file: Optional[Path] = None) -> Set[str]:
    """Union of references across the five sources: the section markdown
    columns, blocks, custom phases, the phase list, and lab_state.json."""
    refs: Set[str] = set()
    for e in session.exec(select(ExperimentDB)).all():
        for col in _SCAN_COLS:
            v = getattr(e, col, None)
            if v is None:
                continue
            # JSON columns (blocks/custom_phases/phases) come back as parsed
            # objects from the ORM; re-serialize to text so the ref scan sees
            # the quoted /uploads/ strings (raw SQL would return them as text).
            t = v if isinstance(v, str) else json.dumps(v)
            refs |= refs_from_text(t)
    if state_file is not None and state_file.exists():
        refs |= refs_from_text(state_file.read_text(errors="ignore"))
    return refs


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _split_name(original: str):
    if "." in original:
        stem, ext = original.rsplit(".", 1)
        return stem, "." + ext[:MAX_EXT]
    return original, ""


def sync_name(original: str, used: Dict[str, str]) -> str:
    """SharePoint-safe name for an attachment. Sanitizes forbidden chars,
    shortens over-long stems (hash-suffixed so distinct originals never
    collide), and records the mapping in `used` (synced -> original)."""
    stem, ext = _split_name(original)
    stem = _FORBIDDEN.sub("_", stem)
    if len(stem) > MAX_STEM:
        stem = stem[:39] + "_" + sha256_of_name(original)[:5]
    candidate = stem + ext
    if used.get(candidate) not in (None, original):
        # Collision: two distinct originals map to the same name.
        stem = _FORBIDDEN.sub("_", _split_name(original)[0])[:35] + "_" + sha256_of_name(original)[:8]
        candidate = stem + ext
    used[candidate] = original
    return candidate


def sha256_of_name(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sanitize_member(raw: str) -> str:
    s = re.sub(r"[^a-z0-9-]+", "-", raw.lower()).strip("-")
    return s[:32] or "member"


def resolve_member(cli: Optional[str] = None) -> str:
    raw = (
        cli
        or os.environ.get("BENCHFLOW_MEMBER")
        or os.environ.get("USERNAME")
        or os.environ.get("USER")
        or "member"
    )
    return sanitize_member(raw)


def _atomic_write(path: Path, text: str) -> None:
    """Write to a temp file then rename, so the sync client never uploads a
    half-written file (same tearing lesson as the WAL -wal/-db incident)."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def export(
    db_path: Path,
    uploads_dir: Path,
    dest_root: Path,
    member: str,
    state_file: Optional[Path] = None,
) -> Dict:
    """Write <dest_root>/<member>/ (manifest, project JSONs, attachments).
    Returns a summary dict."""
    member = sanitize_member(member)
    member_dir = Path(dest_root) / member
    projects_dir = member_dir / "projects"
    attachments_dir = member_dir / "attachments"
    for d in (projects_dir, attachments_dir):
        d.mkdir(parents=True, exist_ok=True)

    db_path = Path(db_path)
    if state_file is None:
        state_file = db_path.parent / "lab_state.json"

    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        state = get_lab_state(session)
        refs = extract_refs(session, state_file)

    # Project JSONs (names are UUID/short-id based: already SharePoint-safe).
    proj_ids = []
    for p in state.projects:
        _atomic_write(
            projects_dir / f"{_FORBIDDEN.sub('_', p.id)}.json",
            json.dumps(p.model_dump(), indent=2),
        )
        proj_ids.append(p.id)

    # Attachments: referenced files only.
    atts: List[Dict] = []
    skipped_large: List[Dict] = []
    missing: List[str] = []
    used: Dict[str, str] = {}
    for name in sorted(refs):
        src = Path(uploads_dir) / name
        if not src.exists():
            missing.append(name)
            continue
        size = src.stat().st_size
        if size >= SIZE_LIMIT:
            skipped_large.append({"name": name, "size": size, "sha256": sha256_of(src)})
            continue
        sn = sync_name(name, used)
        dst = attachments_dir / sn
        if not dst.exists() or dst.stat().st_size != size:
            shutil.copy2(src, dst)
        atts.append({"name": name, "synced": sn, "size": size})

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "app_version": APP_VERSION,
        "member": member,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "projects": proj_ids,
        "papers": [p.model_dump() for p in state.papers],
        "attachments": atts,
        "skipped_large": skipped_large,
        "missing": missing,
    }
    _atomic_write(member_dir / "manifest.json", json.dumps(manifest, indent=2))

    return {
        "member": member,
        "dest": str(member_dir),
        "projects": len(proj_ids),
        "attachments": len(atts),
        "skipped_large": len(skipped_large),
        "missing": len(missing),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Export a Benchflow notebook into a SharePoint-synced folder")
    ap.add_argument("--dest", required=True, help="Root of the synced BENCHFLOW folder")
    ap.add_argument("--member", help="Member slug (default: $BENCHFLOW_MEMBER, then OS username)")
    ap.add_argument("--db", default=None, help="benchflow.db path (default: this app's data dir)")
    ap.add_argument("--uploads", default=None, help="uploads dir (default: sibling of the data dir)")
    args = ap.parse_args()

    import app.database as database

    db = Path(args.db) if args.db else database.DB_PATH
    uploads = Path(args.uploads) if args.uploads else db.parent.parent / "uploads"
    summary = export(db, uploads, Path(args.dest), resolve_member(args.member))
    print(
        f"exported {summary['projects']} projects, {summary['attachments']} attachments "
        f"({summary['skipped_large']} skipped >=200MB, {summary['missing']} missing) "
        f"-> {summary['dest']}"
    )


if __name__ == "__main__":
    main()
