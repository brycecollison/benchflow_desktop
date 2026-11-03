"""Load Benchflow exports from a SharePoint-synced BENCHFLOW folder into a local DB.

Designed for the PI's machine: sync the BENCHFLOW folder (Select folders),
then run

    python -m app.sharepoint_loader --folder C:\\OneDrive\\BENCHFLOW

The target DB is **rebuilt from all members on every run** (wipe + re-derive,
per the ingest-only convention), so the PI portal can never drift from the
members' sources of truth and projects deleted on a member's machine disappear
here on the next ingest.

Attachments are mirrored into the local uploads/ dir under their *original*
names (the manifest carries the synced->original mapping), so the same
/uploads/... links in section markdown resolve in the PI portal unchanged.
Metadata-only entries (files >=200 MB that were never synced) have nothing to
copy; the portal sees them as "exists, not synced".
"""

import argparse
import json
import shutil
from pathlib import Path
from typing import Dict, List, Optional

from sqlmodel import Session, SQLModel, create_engine, delete

import app.database as database
from app.db_service import save_lab_state
from app.models import (
    ExperimentDB,
    ExperimentDependencyDB,
    PaperDB,
    ProjectDB,
    ProjectPaperLinkDB,
)
from app.schemas import LabState, Paper, Project
from app.sharepoint_export import SCHEMA_VERSION


def _wipe(session: Session) -> None:
    for model in (ExperimentDependencyDB, ProjectPaperLinkDB,
                  ExperimentDB, ProjectDB, PaperDB):
        session.exec(delete(model))
    session.commit()


def load(
    folder_root: Path,
    db_path: Optional[Path] = None,
    uploads_dir: Optional[Path] = None,
) -> Dict:
    """Ingest every member folder under folder_root into db_path/uploads_dir.
    Returns a summary dict."""
    db_path = Path(db_path) if db_path else database.DB_PATH
    uploads_dir = Path(uploads_dir) if uploads_dir else db_path.parent.parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    members: List[str] = []
    projects: List[Project] = []
    papers: Dict[str, Paper] = {}
    atts: List[Dict] = []          # {"member_dir": Path, "name": str, "synced": str}
    skipped_large = 0
    schema_skipped: List[str] = []

    with Session(engine) as session:
        _wipe(session)
        for member_dir in sorted(Path(folder_root).iterdir()):
            mf = member_dir / "manifest.json"
            if not mf.exists():
                continue
            man = json.loads(mf.read_text(encoding="utf-8"))
            if man.get("schema_version", 1) > SCHEMA_VERSION:
                schema_skipped.append(member_dir.name)
                continue
            members.append(member_dir.name)
            for p in man.get("papers", []):
                papers.setdefault(p["id"], Paper(**p))
            for pf in sorted((member_dir / "projects").glob("*.json")):
                projects.append(Project(**json.loads(pf.read_text(encoding="utf-8"))))
            for a in man.get("attachments", []):
                atts.append({"member_dir": member_dir, "name": a["name"], "synced": a["synced"]})
            skipped_large += len(man.get("skipped_large", []))

        save_lab_state(session, LabState(projects=projects, papers=list(papers.values())))

    # Mirror attachments back under their original names (lazy: skip if present).
    copied = already = 0
    for a in atts:
        src = a["member_dir"] / "attachments" / a["synced"]
        dst = uploads_dir / a["name"]
        if not src.exists() or dst.exists():
            already += 1
            continue
        shutil.copy2(src, dst)
        copied += 1

    return {
        "members": members,
        "projects": len(projects),
        "papers": len(papers),
        "attachments_copied": copied,
        "attachments_present": already,
        "skipped_large": skipped_large,
        "schema_skipped": schema_skipped,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Load Benchflow exports from a synced BENCHFLOW folder")
    ap.add_argument("--folder", required=True, help="Root of the synced BENCHFLOW folder")
    ap.add_argument("--db", default=None, help="Target benchflow.db (default: this app's data dir)")
    ap.add_argument("--uploads", default=None, help="Target uploads dir (default: sibling of the data dir)")
    args = ap.parse_args()

    db = Path(args.db) if args.db else database.DB_PATH
    uploads = Path(args.uploads) if args.uploads else db.parent.parent / "uploads"
    s = load(Path(args.folder), db, uploads)
    print(
        f"loaded {len(s['members'])} member(s) {s['members']}: {s['projects']} projects, "
        f"{s['papers']} papers, {s['attachments_copied']} attachments copied "
        f"({s['attachments_present']} already present), {s['skipped_large']} large-file metadata entries"
    )
    if s["schema_skipped"]:
        print(f"WARNING: skipped member folders with newer schema_version: {s['schema_skipped']}")


if __name__ == "__main__":
    main()
