import os
import sys
import json
import uuid
import shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session, select

from app.schemas import LabState, UploadResponse
from app.image_processor import process_uploaded_file
from app.database import init_db, get_session, engine, DB_PATH
from app.paths import BASE_DIR, DATA_DIR, UPLOAD_DIR, STATE_FILE
from app.models import ExperimentDB, ProjectDB, PaperDB
from app.db_service import (
    init_data_if_empty,
    get_lab_state,
    save_lab_state,
    reset_lab_state,
    get_setting,
    set_setting,
)
from app.desktop_import import ensure_data_seeded

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# The code tree and the data tree must not share a parent that a sync client watches:
# app/paths.py lets DATA_DIR/UPLOAD_DIR live in the synced tree while the repo stays out.
REPO_ROOT = BASE_DIR.parent


def _dist_dir() -> Path:
    """Built frontend, served at "/" on the same origin (no Vite at runtime).

    Frozen: the copy bundled under sys._MEIPASS (see packaging/benchflow.spec).
    Dev:    this repo's frontend/dist (run `npm run build` to populate it).
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "frontend" / "dist"
    return REPO_ROOT / "frontend" / "dist"


DIST_DIR = _dist_dir()

# Default seed state if none exists yet
DEFAULT_STATE = {
    "projects": [
        {
            "id": "proj-crispr-01",
            "name": "CRISPR-Cas9 Knockout Assay",
            "paperIds": ["paper-nature-2026"],
            "exps": [
                {
                    "id": "exp-sgRNA-design",
                    "name": "sgRNA Design & Synthesis",
                    "status": "Done",
                    "priority": "High",
                    "paper": "paper-nature-2026",
                    "deps": [],
                    "notes": "Targeted exon 3 of kinase gene. Synthesized via IDT with phosphorothioate end-modifications for increased stability in HEK293T cells.",
                    "blocks": [
                        {
                            "type": "txt",
                            "name": "Target Oligo Sequences",
                            "text": "Top strand: 5'-CACCGCCTGAGTCGTACTAGCGTA-3'\nBottom strand: 5'-AAACTACGCTAGTACGACTCAGGC-3'"
                        }
                    ],
                    "px": 40,
                    "py": 80
                },
                {
                    "id": "exp-electroporation",
                    "name": "Electroporation of HEK293T",
                    "status": "Done",
                    "priority": "High",
                    "paper": "paper-nature-2026",
                    "deps": ["exp-sgRNA-design"],
                    "notes": "Neon Transfection system: 1150V, 20ms pulse width, 2 pulses. 1.5 ug RNP complex per 200,000 cells.",
                    "blocks": [],
                    "px": 300,
                    "py": 80
                },
                {
                    "id": "exp-t7-assay",
                    "name": "T7 Endonuclease I Cleavage",
                    "status": "Running",
                    "priority": "Med",
                    "paper": "paper-nature-2026",
                    "deps": ["exp-electroporation"],
                    "notes": "Genomic DNA extracted at 48h post-electroporation. PCR amplification of target locus followed by denaturation and re-annealing.",
                    "blocks": [
                        {
                            "type": "tbl",
                            "name": "Quantification of Cleavage Bands",
                            "rows": [
                                ["Sample", "Parent Band (bp)", "Cleaved 1 (bp)", "Cleaved 2 (bp)", "Estimated Indel %"],
                                ["WT Control", "540", "-", "-", "0.0%"],
                                ["Guide #1", "540", "320", "220", "42.8%"],
                                ["Guide #2", "540", "310", "230", "38.5%"],
                                ["Negative Ctrl", "540", "-", "-", "0.2%"]
                            ]
                        }
                    ],
                    "px": 560,
                    "py": 40
                },
                {
                    "id": "exp-western-blot",
                    "name": "Western Blot Validation",
                    "status": "Planned",
                    "priority": "Med",
                    "paper": "paper-nature-2026",
                    "deps": ["exp-electroporation"],
                    "notes": "Evaluate protein knockout levels with anti-Kinase antibody (Rabbit mAb, 1:1000 dilution) and beta-actin loading control.",
                    "blocks": [],
                    "px": 560,
                    "py": 160
                },
                {
                    "id": "exp-cell-viability",
                    "name": "CellTiter-Glo Viability Assay",
                    "status": "Planning",
                    "priority": "Low",
                    "paper": "",
                    "deps": ["exp-western-blot"],
                    "notes": "Assess whether kinase knockout impairs cell proliferation rate over 72 hours.",
                    "blocks": [],
                    "px": 820,
                    "py": 160
                }
            ]
        }
    ],
    "papers": [
        {
            "id": "paper-nature-2026",
            "name": "Precision Cas9 Cleavage Mechanisms",
            "color": "#2f6f5e"
        },
        {
            "id": "paper-methods-review",
            "name": "High-Throughput ELN Protocol Guide",
            "color": "#4a6fa5"
        }
    ]
}


def _parse_import_arg() -> str | None:
    """The --import <dir> value, if present (scripting path).

    Checked as an env var first (run.py forwards the CLI arg there, because uvicorn
    replaces sys.argv), then on the command line (the frozen exe passes it through).
    """
    env = (os.environ.get("BENCHFLOW_IMPORT") or "").strip()
    if env:
        return env
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--import" and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith("--import="):
            return a.split("=", 1)[1]
    return None


# First run: seed the desktop data folder (copy, never move) BEFORE any db access.
# No-op once benchflow.db exists. Source order: --import <dir> > first-run dialog > bundled seed.
ensure_data_seeded(_parse_import_arg())

# Initialize database immediately on startup
init_db()
with Session(engine) as _startup_session:
    init_data_if_empty(_startup_session, STATE_FILE, DEFAULT_STATE)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    warn_if_code_in_onedrive()
    with Session(engine) as session:
        init_data_if_empty(session, STATE_FILE, DEFAULT_STATE)
    yield
    shutdown_export()
    shutdown_backup()


def _onedrive_roots():
    """Local OneDrive roots known to this machine (personal, commercial, consumer).

    The registry is checked first: a shell with a stale environment block (a service, an
    old terminal) has no OneDrive variables, and this drives a warning the user must trust.
    """
    roots = []
    try:
        import winreg

        for account in ("Personal", "Business"):
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                rf"Software\Microsoft\OneDrive\Accounts\{account}") as key:
                roots.append(Path(winreg.QueryValueEx(key, "UserFolder")[0]))
    except OSError:
        # not Windows, or OneDrive configured only for another account
        pass
    roots += [Path(v) for k in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial")
              if (v := os.environ.get(k))]
    return [r for r in roots if r]


def _under(child: Path, parent: Path) -> bool:
    """Case-insensitive containment, without resolving the filesystem: OneDrive is a reparse
    point, and Path.resolve() can flatten it (and any path under it) to the user profile.
    """
    c = os.path.normcase(os.path.abspath(str(child)))
    p = os.path.normcase(os.path.abspath(str(parent)))
    return c == p or c.startswith(p.rstrip("\\/") + os.sep)


def _in_onedrive(path: Path) -> bool:
    return any(_under(path, r) for r in _onedrive_roots())


def warn_if_code_in_onedrive() -> None:
    """A synced repo drags .git and machine-built venv wheels between machines, and turns
    the code into a backup target. Warn, since that is the state this app shipped in."""
    if _in_onedrive(REPO_ROOT):
        print(
            f"[WARN] the repository is inside a OneDrive folder ({REPO_ROOT}); only the data "
            "and backup folders belong in the synced tree - clone the code outside OneDrive."
        )


_URL_PREFIXES = ("http://", "https://", "file://")


def sharepoint_run_export(session: Session) -> Dict[str, Any]:
    """Export the notebook into the configured sync folder; record the summary."""
    from app.sharepoint_export import export, resolve_member

    dest = get_setting(session, "sharepoint_dir")
    if dest.lower().startswith(_URL_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail="The sync folder must be a local folder path, not a web URL. "
            "Add the SharePoint folder to the OneDrive sync client and enter its local path.",
        )
    member = get_setting(session, "sharepoint_member")
    summary = export(DB_PATH, UPLOAD_DIR, Path(dest), member or resolve_member(None))
    summary["at"] = datetime.now(timezone.utc).isoformat()
    set_setting(session, "sharepoint_last_export", json.dumps(summary))
    return summary

def shutdown_export() -> None:
    """If a sync folder is configured in Settings, export on shutdown.
    Never blocks shutdown."""
    try:
        with Session(engine) as session:
            if not get_setting(session, "sharepoint_dir"):
                return
            summary = sharepoint_run_export(session)
            print(
                f"[sharepoint] exported {summary['projects']} projects, "
                f"{summary['attachments']} attachments -> {summary['dest']}"
            )
    except Exception as e:
        print(f"[WARN] shutdown export failed: {e}")


app = FastAPI(title="Lab Planner & ELN API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "Lab Planner & ELN",
        "database": "sqlite",
        "db_path": str(DB_PATH),
        "uploads_dir": str(UPLOAD_DIR)
    }


@app.get("/api/lab/state", response_model=LabState)
def get_state(session: Session = Depends(get_session)):
    return get_lab_state(session)


@app.post("/api/lab/state")
def update_state(state: LabState, session: Session = Depends(get_session)):
    save_lab_state(session, state)
    
    # Also write a JSON backup file asynchronously / as secondary safety
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state.model_dump(), f, indent=2)
    except Exception as e:
        print(f"[WARN] Failed to write JSON backup: {e}")

    return {"status": "success", "updated_at": datetime.now(timezone.utc).isoformat()}


@app.post("/api/lab/reset")
def reset_to_default(session: Session = Depends(get_session)):
    reset_lab_state(session, DEFAULT_STATE)
    state = get_lab_state(session)
    return {"status": "reset", "state": state}


class OneNoteImportRequest(BaseModel):
    section_path: Optional[str] = None
    project_name: Optional[str] = "Cohesin IPs"


@app.post("/api/lab/import/onenote")
def import_onenote_endpoint(
    req: OneNoteImportRequest,
    session: Session = Depends(get_session)
):
    from app.onenote_importer import import_onenote_section, DEFAULT_ONENOTE_SECTION
    path = req.section_path or DEFAULT_ONENOTE_SECTION
    name = req.project_name or "Cohesin IPs"
    try:
        result = import_onenote_section(
            section_file_path=path,
            project_name=name,
            session=session,
            upload_dir=UPLOAD_DIR,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# Granular position update endpoint (optimized for drag-and-drop on flowchart)
class PositionPayload(BaseModel):
    px: float
    py: float

@app.patch("/api/experiments/{exp_id}/position")
def update_experiment_position(
    exp_id: str,
    pos: PositionPayload,
    session: Session = Depends(get_session)
):
    exp = session.get(ExperimentDB, exp_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    exp.px = pos.px
    exp.py = pos.py
    exp.updated_at = datetime.now(timezone.utc)
    session.add(exp)
    session.commit()
    return {"status": "success", "id": exp_id, "px": exp.px, "py": exp.py}


class SharepointConfigPayload(BaseModel):
    dir: str
    member: Optional[str] = None


@app.get("/api/sharepoint/config")
def get_sharepoint_config(session: Session = Depends(get_session)):
    d = get_setting(session, "sharepoint_dir")
    m = get_setting(session, "sharepoint_member")
    last = get_setting(session, "sharepoint_last_export")
    return {
        "dir": d,
        "member": m,
        "configured": bool(d),
        "folder_exists": bool(d) and Path(d).is_dir(),
        "last_export": json.loads(last) if last else None,
    }


@app.put("/api/sharepoint/config")
def put_sharepoint_config(req: SharepointConfigPayload, session: Session = Depends(get_session)):
    d = (req.dir or "").strip()
    if not d:
        raise HTTPException(status_code=400, detail="dir is required")
    if d.lower().startswith(_URL_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail="That looks like a web URL. Enter the local folder path on this computer "
            "(e.g. C:\\Users\\you\\OneDrive\\BENCHFLOW) - the OneDrive sync client keeps it in step with SharePoint.",
        )
    set_setting(session, "sharepoint_dir", d)
    if req.member is not None:
        set_setting(session, "sharepoint_member", req.member.strip())
    summary = sharepoint_run_export(session) if Path(d).is_dir() else None
    return {"status": "saved", "folder_exists": Path(d).is_dir(), "export": summary}


@app.post("/api/sharepoint/export")
def export_now(session: Session = Depends(get_session)):
    d = get_setting(session, "sharepoint_dir")
    if not d:
        raise HTTPException(status_code=400, detail="Configure the sync folder in Settings first")
    if not Path(d).is_dir():
        raise HTTPException(status_code=400, detail=f"Folder not found: {d}")
    return sharepoint_run_export(session)


class BackupConfigPayload(BaseModel):
    dir: str


@app.post("/api/backup/browse")
def browse_backup_folder(req: BackupConfigPayload):
    from app.folder_picker import browse_folder

    try:
        return {"dir": browse_folder(req.dir)}
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Could not open the folder browser. Enter the folder path manually instead. "
            "Browsing requires Python with Tk support and a desktop session on the computer running the app.",
        )


def _backup_dest_or_400(raw: str) -> Path:
    """A local backup folder, and never one inside the code tree."""
    d = (raw or "").strip()
    if not d:
        raise HTTPException(status_code=400, detail="dir is required")
    if d.lower().startswith(_URL_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail="The backup folder must be a local folder path, not a web URL "
            "(e.g. C:\\Users\\you\\OneDrive\\BenchflowBackup).",
        )
    dest = Path(d).expanduser()
    if _under(dest, REPO_ROOT):
        raise HTTPException(
            status_code=400,
            detail=f"The backup folder cannot sit inside the code folder ({REPO_ROOT}) - that is "
            "how the app itself ends up in OneDrive. Choose a path outside it.",
        )
    return dest


def backup_run(session: Session) -> Dict[str, Any]:
    """Snapshot db + referenced attachments into the configured folder; record the summary."""
    from app.backup import run_backup

    dest = _backup_dest_or_400(get_setting(session, "backup_dir") or "")
    summary = run_backup(DB_PATH, UPLOAD_DIR, dest)
    set_setting(session, "backup_last", json.dumps(summary))
    return summary


def shutdown_backup() -> None:
    """Snapshot to the configured OneDrive folder on shutdown. Never blocks shutdown."""
    try:
        with Session(engine) as session:
            if not get_setting(session, "backup_dir"):
                return
            s = backup_run(session)
            print(
                f"[backup] db {s['db_bytes'] / 1024:.0f} KB, {s['copied']} new attachments "
                f"-> {s['dest']} ({s['unreferenced_count']} unreferenced files not copied)"
            )
    except Exception as e:
        print(f"[WARN] shutdown backup failed: {e}")


@app.get("/api/backup/config")
def get_backup_config(session: Session = Depends(get_session)):
    d = get_setting(session, "backup_dir")
    last = get_setting(session, "backup_last")
    return {
        "dir": d,
        "configured": bool(d),
        "folder_exists": bool(d) and Path(d).is_dir(),
        "in_onedrive": bool(d) and _in_onedrive(Path(d)),
        "last_backup": json.loads(last) if last else None,
    }


@app.put("/api/backup/config")
def put_backup_config(req: BackupConfigPayload, session: Session = Depends(get_session)):
    dest = _backup_dest_or_400(req.dir)
    set_setting(session, "backup_dir", str(dest))
    dest.mkdir(parents=True, exist_ok=True)
    summary = backup_run(session)
    warning = None
    if not _in_onedrive(dest):
        warning = ("That folder is not inside a OneDrive folder on this machine, so nothing is "
                   "being backed up to the cloud yet.")
    return {"status": "saved", "folder_exists": True, "in_onedrive": _in_onedrive(dest),
            "warning": warning, "backup": summary}


@app.post("/api/backup")
def backup_now(session: Session = Depends(get_session)):
    if not get_setting(session, "backup_dir"):
        raise HTTPException(status_code=400, detail="Configure the OneDrive backup folder in Settings first")
    return backup_run(session)


@app.post("/api/lab/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    filename = (file.filename or "upload").replace("\\", "/").rsplit("/", 1)[-1] or "upload"
    unique_name = f"{uuid.uuid4().hex[:12]}_{filename}"
    file_path = UPLOAD_DIR / unique_name

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    size = os.path.getsize(file_path)
    raw_url = f"/uploads/{unique_name}"

    # Process scientific images (TIFF, ND2, etc.) to generate web-viewable previews
    preview_url, metadata = process_uploaded_file(file_path, UPLOAD_DIR)

    display_url = preview_url if preview_url else raw_url

    return UploadResponse(
        filename=filename,
        url=display_url,
        preview_url=preview_url,
        raw_url=raw_url,
        content_type=file.content_type or "application/octet-stream",
        size=size,
        metadata=metadata if metadata else None
    )


# Serve the built React app from the same origin. Mounted LAST so /api and /uploads
# keep precedence. No SPA history fallback: the app has no router (views live in the
# Zustand store), so a plain StaticFiles(html=True) is enough. Guarded so the backend
# still starts in dev when frontend/dist has not been built yet.
if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="frontend")
